require('dotenv').config();
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { GameStatsFactory } = require("./stats");
const AIServerService = require('./aiServerService');
const AIGamesFileService = require('./aiGamesFileService');
const { generateAIKey } = require('./keyGenerator');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const gameStats = GameStatsFactory.create();
const aiService = new AIServerService();
const aiGamesFile = new AIGamesFileService();

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/stats", (req, res) => {
  res.json(gameStats.getStats());
});

// Роут для отдачи AI игр файла
app.get("/dictionaries/ai_games.json", (req, res) => {
  res.sendFile(path.join(__dirname, "data", "ai_games.json"));
});

// API эндпоинт для генерации ИИ-слов
app.post('/api/generate-words', async (req, res) => {
  try {
    const { topic } = req.body;
    
    if (!topic || !topic.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Тема не указана'
      });
    }
    
    // Генерируем уникальный ключ
    let key;
    let attempts = 0;
    do {
      key = generateAIKey();
      attempts++;
      if (attempts > 10) {
        throw new Error('Не удалось сгенерировать уникальный ключ');
      }
    } while (await aiGamesFile.gameExists(key));
    
    // Генерируем слова через ИИ
    const words = await aiService.generateWords(topic.trim());
    
    // Сохраняем игру в файл
    await aiGamesFile.addGame(key, words, topic.trim());
    
    res.json({
      success: true,
      key: key,
      words: words,
      topic: topic.trim()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

const activeGames = new Map();

const calculateDerivedState = (game) => {
  const { colors, revealed } = game;
  const remainingCards = {
    blue: colors.reduce((sum, c, i) => sum + (c === "blue" && !revealed[i] ? 1 : 0), 0),
    red: colors.reduce((sum, c, i) => sum + (c === "red" && !revealed[i] ? 1 : 0), 0),
  };
  const isBlackRevealed = colors.some((c, i) => c === "black" && revealed[i]);
  const isBlueWin = remainingCards.blue === 0;
  const isRedWin = remainingCards.red === 0;
  const gameOver = isBlackRevealed || isBlueWin || isRedWin;
  const winner = isBlackRevealed ? "assassin" : isBlueWin ? "blue" : isRedWin ? "red" : null;

  Object.assign(game, { remainingCards, gameOver, winner });
};

const mergeGameStates = (baseState, newState) => {
  if (!baseState) return newState;
  const revealed = baseState.revealed.map((isRevealed, index) => isRevealed || newState.revealed[index]);
  return { ...baseState, revealed };
};

const createNewGameState = (gameKey, words = [], colors = [], savedState = null) => {
  const game = {
    words,
    colors,
    revealed: Array(25).fill(false),
    currentTeam: "blue",
    remainingCards: { blue: 0, red: 0 },
    gameOver: false,
    winner: null,
    lastActivity: Date.now(),
    players: new Set(),
  };

  if (savedState) {
    game.revealed = savedState.revealed || game.revealed;
    game.currentTeam = savedState.currentTeam || game.currentTeam;
  }

  calculateDerivedState(game);
  return game;
};

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  let currentGame = null;

  const leaveCurrentGame = () => {
    if (currentGame) {
      socket.leave(currentGame);
      const game = activeGames.get(currentGame);
      if (game) {
        game.players.delete(socket.id);
        if (game.players.size === 0) {
          game.lastActivity = Date.now();
        }
      }
      currentGame = null;
    }
  };

  socket.on("JOIN_GAME", ({ gameKey, words, colors, gameState }) => {
    console.log("\n=== JOIN_GAME ===");
    console.log("Player", socket.id, "joining game:", gameKey);
    console.log("Has words:", !!words);
    console.log("Has colors:", !!colors);
    console.log("Has game state:", !!gameState);

    leaveCurrentGame();

    let game = activeGames.get(gameKey);

    if (!game && words && colors) {
      console.log("Creating new game state");
      game = createNewGameState(gameKey, words, colors, gameState);
      activeGames.set(gameKey, game);
      gameStats.addGame(gameKey);
    }

    if (game) {
      if (gameState) {
        console.log("Merging states");
        const merged = mergeGameStates(game, gameState);
        game.revealed = merged.revealed;
        calculateDerivedState(game);
      }

      socket.join(gameKey);
      currentGame = gameKey;
      game.players.add(socket.id);
      game.lastActivity = Date.now();

      console.log("Player joined successfully");
      console.log("Current players:", game.players.size);
      console.log("Remaining cards:", game.remainingCards);
      console.log("Revealed cards:", game.revealed.filter((r) => r).length);

      io.to(gameKey).emit("GAME_STATE", game);

      socket.to(gameKey).emit("PLAYER_JOINED", {
        playerId: socket.id,
        playerCount: game.players.size,
      });
    } else {
      console.log("Failed to join - no game state");
    }
    console.log("=== END JOIN_GAME ===\n");
  });

  socket.on("NEW_GAME", ({ gameKey, words, colors }) => {
    console.log("\n=== NEW_GAME ===");
    console.log("Creating game:", gameKey);

    leaveCurrentGame();

    const game = createNewGameState(gameKey, words, colors);
    activeGames.set(gameKey, game);
    gameStats.addGame(gameKey);

    socket.join(gameKey);
    currentGame = gameKey;
    game.players.add(socket.id);

    console.log("Game created successfully");
    console.log("First player:", socket.id);

    io.to(gameKey).emit("GAME_STATE", game);
    console.log("=== END NEW_GAME ===\n");
  });

  socket.on("REVEAL_CARD", ({ gameKey, cardIndex }) => {
    console.log("\n=== REVEAL_CARD ===");
    console.log("Game key:", gameKey);
    console.log("Card index:", cardIndex);
    console.log("Current game:", currentGame);

    if (currentGame !== gameKey) {
      console.log("Current game mismatch!");
      return;
    }

    const game = activeGames.get(gameKey);
    console.log("Game exists:", !!game);

    if (!game || game.revealed[cardIndex]) {
      console.log("Game not found or card already revealed");
      console.log("Revealed status:", game?.revealed[cardIndex]);
      return;
    }

    game.revealed[cardIndex] = true;
    game.lastActivity = Date.now();

    const cardColor = game.colors[cardIndex];
    console.log("Card color:", cardColor);

    if (cardColor !== game.currentTeam || cardColor === "neutral") {
      console.log("Switching team from", game.currentTeam);
      game.currentTeam = game.currentTeam === "blue" ? "red" : "blue";
      console.log("to", game.currentTeam);
    }

    calculateDerivedState(game);
    console.log("Remaining cards after:", { ...game.remainingCards });

    if (game.gameOver && game.winner) {
      gameStats.completeGame(gameKey);
      console.log("Game over! Winner:", game.winner);
    }

    io.to(gameKey).emit("GAME_STATE", game);
    console.log("Game state sent to room");
    console.log("=== END REVEAL_CARD ===\n");
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    leaveCurrentGame();
  });
});

setInterval(() => {
  console.log("\n=== CLEANUP ===");
  const oneHourAgo = Date.now() - 3600000;
  let cleanedGames = 0;

  activeGames.forEach((game, key) => {
    if (game.lastActivity < oneHourAgo) {
      console.log("Cleaning game:", key);
      console.log("Last activity:", new Date(game.lastActivity));
      gameStats.removeGame(key);
      activeGames.delete(key);
      cleanedGames++;
    }
  });

  console.log("Games cleaned:", cleanedGames);
  console.log("Remaining games:", activeGames.size);
  console.log("=== END CLEANUP ===\n");
}, 3600000);

const PORT = process.env.PORT;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`View statistics at http://localhost:${PORT}/`);
});

process.on('SIGINT', async () => {
  console.log('\nShutting down server...');
  await gameStats.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down server...');
  await gameStats.shutdown();
  process.exit(0);
});