const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;


// Serve static files (index.html, mobile.html, etc.) from public folder
app.use(express.static(path.join(__dirname, "public")));

// In-memory session storage
const sessions = {};

// Fashion items data
const fashionItems = [
  { number: 1, emoji: "👕", offer: "T-Shirt: 30% OFF" },
  { number: 2, emoji: "🧢", offer: "Cap: Buy 1 Get 1 Free" },
  { number: 3, emoji: "👖", offer: "Jeans: Limited Edition" },
  { number: 4, emoji: "👟", offer: "Sneakers: Flash Sale" },
  { number: 5, emoji: "🕶️", offer: "Sunglasses: 50% OFF" },
  { number: 6, emoji: "👔", offer: "Shirt: Premium Collection" },
  { number: 7, emoji: "🧥", offer: "Jacket: Winter Special" },
  { number: 8, emoji: "👗", offer: "Dress: New Arrival" },
  { number: 9, emoji: "🩳", offer: "Shorts: Summer Deal" },
];

// Utility to remove circular references before sending game state
function getCleanGameState(game) {
  return {
    sessionId: game.sessionId,
    currentSequence: game.currentSequence,
    flippedCards: game.flippedCards,
    gameWon: game.gameWon,
    score: game.score,
    startTime: game.startTime,
    cards: game.cards,
  };
}

// Shuffle array function
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Host creates a new game
  socket.on("new-game", () => {
    const sessionId = uuidv4();

    // Create and shuffle cards
    const shuffledCards = shuffleArray([...fashionItems]);

    sessions[sessionId] = {
      sessionId,
      currentSequence: 1,
      flippedCards: [],
      gameWon: false,
      score: 0,
      startTime: Date.now(),
      cards: shuffledCards,
      hostSocket: socket,
      mobileSocket: null,
      firstCardFound: false,
    };

    socket.sessionId = sessionId;
    socket.join(sessionId);

    // Send clean state back to host
    socket.emit("game-state", getCleanGameState(sessions[sessionId]));
  });

  // Mobile joins with a session
  socket.on("mobile-connect", ({ sessionId }) => {
    const game = sessions[sessionId];
    if (!game) {
      socket.emit("session-not-found");
      return;
    }

    game.mobileSocket = socket;
    socket.sessionId = sessionId;
    socket.join(sessionId);

    // Notify both parties
    io.to(sessionId).emit("mobile-connected");

    // Send game state to mobile
    socket.emit("game-state", getCleanGameState(game));
  });

  socket.on("flip-card", ({ index, sessionId }) => {
    const game = sessions[sessionId];
    if (!game || game.gameWon) return;

    const cardNumber = game.cards[index].number;

    if (!game.firstCardFound) {
      // Before first card is found
      if (cardNumber === 1) {
        // Correct first card found
        game.firstCardFound = true;
        game.flippedCards.push(index);
        game.currentSequence = 2;
        game.score += 10;
        io.to(sessionId).emit("game-state", getCleanGameState(game));
      } else {
        // Wrong card - schedule unflip after 2 seconds
        const tempFlipped = [...game.flippedCards, index];
        io.to(sessionId).emit("temp-flip", { index, sessionId });

        setTimeout(() => {
          if (sessions[sessionId] && !sessions[sessionId].firstCardFound) {
            io.to(sessionId).emit("unflip-card", { index, sessionId });
          }
        }, 1000);
      }
    } else {
      // After first card is found
      if (cardNumber === game.currentSequence) {
        // Correct card flipped
        game.flippedCards.push(index);
        game.currentSequence++;
        game.score += 10;

        if (game.currentSequence > 12) {
          game.gameWon = true;
        }
        io.to(sessionId).emit("game-state", getCleanGameState(game));
      } else {
        // Wrong card flipped - reset all cards
        game.flippedCards = [];
        game.currentSequence = 1;
        game.firstCardFound = false;
        game.score = Math.max(0, game.score - 5);
        io.to(sessionId).emit("game-state", getCleanGameState(game));
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    const sessionId = socket.sessionId;
    if (!sessionId || !sessions[sessionId]) return;

    const game = sessions[sessionId];

    if (game.hostSocket === socket) game.hostSocket = null;
    if (game.mobileSocket === socket) game.mobileSocket = null;

    // Clean up session if both disconnected
    if (!game.hostSocket && !game.mobileSocket) {
      delete sessions[sessionId];
      console.log(`Session ${sessionId} removed`);
    }
  });
});

// Handle mobile.html route separately
app.get("/mobile", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "mobile.html"));
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
