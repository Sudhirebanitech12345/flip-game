const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Configuration
const CORS_ORIGINS = ["http://localhost:3000", "https://flip-game-f54r.onrender.com"];
const FASHION_ITEMS = [
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

// Setup
app.use(express.static(path.join(__dirname, "public")));
const io = socketIo(server, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Game state management
const sessions = new Map();

function createNewGameSession(hostSocket) {
  const sessionId = uuidv4();
  const shuffledCards = [...FASHION_ITEMS].sort(() => Math.random() - 0.5);
  
  const gameSession = {
    sessionId,
    currentSequence: 1,
    flippedCards: [],
    gameWon: false,
    score: 0,
    startTime: Date.now(),
    cards: shuffledCards,
    hostSocket,
    mobileSocket: null,
    firstCardFound: false
  };
  
  sessions.set(sessionId, gameSession);
  hostSocket.sessionId = sessionId;
  hostSocket.join(sessionId);
  
  return gameSession;
}

function handleCardFlip(game, index) {
  const cardNumber = game.cards[index].number;
  
  if (!game.firstCardFound) {
    handleFirstCardFlip(game, index, cardNumber);
  } else {
    handleSubsequentCardFlip(game, index, cardNumber);
  }
}

function handleFirstCardFlip(game, index, cardNumber) {
  if (cardNumber === 1) {
    game.firstCardFound = true;
    game.flippedCards.push(index);
    game.currentSequence = 2;
    game.score += 10;
    emitGameState(game);
  } else {
    emitTemporaryFlip(game, index);
  }
}

function handleSubsequentCardFlip(game, index, cardNumber) {
  if (cardNumber === game.currentSequence) {
    game.flippedCards.push(index);
    game.currentSequence++;
    game.score += 10;

    if (game.currentSequence > game.cards.length) {
      game.gameWon = true;
    }
    emitGameState(game);
  } else {
    resetGameState(game);
    emitGameState(game);
  }
}

function emitTemporaryFlip(game, index) {
  io.to(game.sessionId).emit("temp-flip", { index });
  setTimeout(() => {
    if (sessions.get(game.sessionId) && !sessions.get(game.sessionId).firstCardFound) {
      io.to(game.sessionId).emit("unflip-card", { index });
    }
  }, 1000);
}

function resetGameState(game) {
  game.flippedCards = [];
  game.currentSequence = 1;
  game.firstCardFound = false;
  game.score = Math.max(0, game.score - 5);
}

function emitGameState(game) {
  io.to(game.sessionId).emit("game-state", {
    sessionId: game.sessionId,
    currentSequence: game.currentSequence,
    flippedCards: game.flippedCards,
    gameWon: game.gameWon,
    score: game.score,
    startTime: game.startTime,
    cards: game.cards,
    firstCardFound: game.firstCardFound
  });
}

// Socket.io event handlers
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("new-game", () => {
    const game = createNewGameSession(socket);
    emitGameState(game);
  });

  socket.on("mobile-connect", ({ sessionId }) => {
    const game = sessions.get(sessionId);
    if (!game) {
      socket.emit("session-not-found");
      return;
    }

    game.mobileSocket = socket;
    socket.sessionId = sessionId;
    socket.join(sessionId);

    io.to(sessionId).emit("mobile-connected");
    emitGameState(game);
  });

  socket.on("flip-card", ({ index, sessionId }) => {
    const game = sessions.get(sessionId);
    if (!game || game.gameWon) return;
    
    handleCardFlip(game, index);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    const sessionId = socket.sessionId;
    if (!sessionId) return;

    const game = sessions.get(sessionId);
    if (!game) return;

    if (game.hostSocket === socket) game.hostSocket = null;
    if (game.mobileSocket === socket) game.mobileSocket = null;

    if (!game.hostSocket && !game.mobileSocket) {
      sessions.delete(sessionId);
      console.log(`Session ${sessionId} removed`);
    }
  });
});

// Routes
app.get("/mobile", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "mobile.html"));
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});