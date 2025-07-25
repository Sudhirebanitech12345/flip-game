const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

// Add this before Socket.IO initialization
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

// Enable CORS middleware
app.use(
  cors({
    origin: ["http://localhost:3000", "https://flip-game-f54r.onrender.com"],
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// Update your CORS configuration in server.js
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "https://flip-game-f54r.onrender.com"],
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["my-custom-header"],
    transports: ["websocket", "polling"], // Add this line
    optionsSuccessStatus: 200, // Some legacy browsers choke on 204
  },
});

const PORT = process.env.PORT || 3000;

// Serve static files from public folder
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
  { number: 10, emoji: "👠", offer: "Heels: Luxury Line" },
  { number: 11, emoji: "🎒", offer: "Backpack: Student Discount" },
  { number: 12, emoji: "🧦", offer: "Socks: 3 for 2" },
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
    firstCardFound: game.firstCardFound,
  };
}

// Shuffle array function
function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Host creates a new game
  socket.on("new-game", () => {
    const sessionId = uuidv4();
    const shuffledCards = shuffleArray(fashionItems);

    sessions[sessionId] = {
      sessionId,
      currentSequence: 1,
      flippedCards: [],
      gameWon: false,
      score: 0,
      startTime: Date.now(),
      cards: shuffledCards,
      hostSocket: socket.id,
      mobileSocket: null,
      firstCardFound: false,
    };

    socket.sessionId = sessionId;
    socket.join(sessionId);

    socket.emit("game-state", getCleanGameState(sessions[sessionId]));
    console.log(`New game session created: ${sessionId}`);
  });

  // Mobile joins with a session
  socket.on("mobile-connect", ({ sessionId }) => {
    const game = sessions[sessionId];
    if (!game) {
      socket.emit("session-not-found");
      console.log(`Session not found: ${sessionId}`);
      return;
    }

    game.mobileSocket = socket.id;
    socket.sessionId = sessionId;
    socket.join(sessionId);

    io.to(sessionId).emit("mobile-connected");
    socket.emit("game-state", getCleanGameState(game));
    console.log(`Mobile client connected to session: ${sessionId}`);
  });

  // Modify the flip-card event handler in server.js
  socket.on("flip-card", ({ index, sessionId }) => {
    const game = sessions[sessionId];
    if (!game || game.gameWon) return;

    const cardNumber = game.cards[index].number;

    if (!game.firstCardFound) {
      if (cardNumber === 1) {
        game.firstCardFound = true;
        game.flippedCards.push(index);
        game.currentSequence = 2;
        game.score += 10;
        io.to(sessionId).emit("game-state", getCleanGameState(game));
      } else {
        // Show the card temporarily to all clients
        io.to(sessionId).emit("temp-flip", { index });
        setTimeout(() => {
          if (sessions[sessionId] && !sessions[sessionId].firstCardFound) {
            io.to(sessionId).emit("unflip-card", { index });
          }
        }, 1000);
      }
    } else {
      if (cardNumber === game.currentSequence) {
        game.flippedCards.push(index);
        game.currentSequence++;
        game.score += 10;

        if (game.currentSequence > 12) {
          game.gameWon = true;
        }
        io.to(sessionId).emit("game-state", getCleanGameState(game));
      } else {
        // Store the current flipped cards before resetting
        const cardsToUnflip = [...game.flippedCards];
        const wrongCardIndex = index;

        game.flippedCards = [];
        game.currentSequence = 1;
        game.firstCardFound = false;
        game.score = Math.max(0, game.score - 5);

        // Show the wrong card briefly
        io.to(sessionId).emit("temp-flip", { index: wrongCardIndex });

        // After 1 second, reset all cards and update state
        setTimeout(() => {
          io.to(sessionId).emit("reset-correct-cards", {
            cardsToUnflip,
            wrongCardIndex,
          });
          io.to(sessionId).emit("game-state", getCleanGameState(game));
        }, 1000);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    const sessionId = socket.sessionId;
    if (!sessionId || !sessions[sessionId]) return;

    const game = sessions[sessionId];

    if (game.hostSocket === socket.id) game.hostSocket = null;
    if (game.mobileSocket === socket.id) game.mobileSocket = null;

    if (!game.hostSocket && !game.mobileSocket) {
      delete sessions[sessionId];
      console.log(`Session ${sessionId} removed`);
    }
  });
});

// Handle mobile.html route
app.get("/mobile", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "mobile.html"));
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
