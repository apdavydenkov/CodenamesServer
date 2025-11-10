require('dotenv').config();
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { GameStatsFactory } = require("./stats");
const ClaudeCodeService = require('./claudeCodeService');
const AIGamesFileService = require('./aiGamesFileService');
const ChatService = require('./chatService');
const AuthService = require('./authService');
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
const claudeService = new ClaudeCodeService();
const aiGamesFile = new AIGamesFileService();
const chatService = new ChatService();
const authService = new AuthService();

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
    
    // Генерируем слова через Claude Code
    const words = await claudeService.generateWords(topic.trim());
    
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

// === AUTH API ENDPOINTS ===

// Проверка существования пользователя
app.post('/api/auth/check-user', async (req, res) => {
  try {
    const { username } = req.body;
    const result = await authService.checkUser(username);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Регистрация нового пользователя
app.post('/api/auth/register', async (req, res) => {
  try {
    const { userId, username } = req.body;
    const result = await authService.registerUser(userId, username);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Проверка PIN-кода
app.post('/api/auth/verify-pin', async (req, res) => {
  try {
    const { username, pin } = req.body;
    const result = await authService.verifyPin(username, pin);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получение пользователя
app.post('/api/auth/get-user', async (req, res) => {
  try {
    const { userId } = req.body;
    const result = await authService.getUser(userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Смена имени
app.post('/api/auth/change-name', async (req, res) => {
  try {
    const { userId, newUsername, pin } = req.body;

    // Проверяем наличие PIN
    if (!pin) {
      console.log(`[Auth API] ❌ Missing PIN in change-name request`);
      return res.status(400).json({ success: false, error: 'PIN не указан' });
    }

    // Получаем текущего пользователя
    const userResult = await authService.getUser(userId);
    if (!userResult.success) {
      console.log(`[Auth API] ❌ User not found: ${userId}`);
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    const currentUsername = userResult.user.username;

    // Проверяем PIN
    const authResult = await authService.verifyPin(currentUsername, pin);
    if (!authResult.success || authResult.user_id !== userId) {
      console.log(`[Auth API] ❌ Invalid PIN for user ${currentUsername} (${userId})`);
      return res.status(403).json({ success: false, error: 'Неверный PIN-код' });
    }

    console.log(`[Auth API] ✅ PIN verified for ${currentUsername}`);

    const result = await authService.changeName(userId, newUsername);

    // Если смена имени успешна, обновляем имя во всех сообщениях чата
    if (result.success) {
      await chatService.updateUsernameInMessages(userId, result.newUsername);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Смена PIN-кода
app.post('/api/auth/change-pin', async (req, res) => {
  try {
    const { userId } = req.body;
    const result = await authService.changePin(userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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

  // === CHAT EVENTS ===

  // Присоединиться к чату игры
  socket.on("JOIN_CHAT", async ({ gameKey }) => {
    try {
      console.log(`[Chat] ${socket.id} joining chat for game: ${gameKey}`);

      // Присоединяем к комнате чата (можем быть в нескольких одновременно)
      const chatRoom = `chat_${gameKey}`;
      socket.join(chatRoom);
      console.log(`[Chat] ${socket.id} joined room: ${chatRoom}`);

      // Загружаем историю чата
      const messages = await chatService.getMessages(gameKey, 100);

      // Отправляем историю клиенту с указанием gameKey
      socket.emit("CHAT_HISTORY", { gameKey, messages });

      console.log(`[Chat] Sent ${messages.length} messages (${gameKey}) to ${socket.id}`);
    } catch (error) {
      console.error("[Chat] Error loading chat history:", error);
      socket.emit("CHAT_ERROR", { message: "Failed to load chat history" });
    }
  });

  // Отправить сообщение в чат
  socket.on("SEND_MESSAGE", async ({ gameKey, userId, author, text, pin }) => {
    try {
      console.log(`[Chat] Message from ${author} (${userId}) in ${gameKey}`);

      // Валидация userId
      if (!userId) {
        socket.emit("CHAT_ERROR", { message: "User not authenticated" });
        console.error("[Chat] Missing userId");
        return;
      }

      // Валидация PIN
      if (!pin) {
        socket.emit("CHAT_ERROR", { message: "PIN not provided" });
        console.error("[Chat] Missing PIN");
        return;
      }

      // Проверяем PIN через authService
      const authResult = await authService.verifyPin(author, pin);

      if (!authResult.success) {
        socket.emit("CHAT_ERROR", { message: "Invalid PIN" });
        console.error(`[Chat] Invalid PIN for user ${author}`);
        return;
      }

      if (authResult.user_id !== userId) {
        socket.emit("CHAT_ERROR", { message: "User ID mismatch" });
        console.error(`[Chat] User ID mismatch: expected ${authResult.user_id}, got ${userId}`);
        return;
      }

      console.log(`[Chat] ✅ PIN verified for ${author}`);

      // Валидация текста
      if (!text || !text.trim()) {
        socket.emit("CHAT_ERROR", { message: "Message cannot be empty" });
        return;
      }

      if (text.length > 500) {
        socket.emit("CHAT_ERROR", { message: "Message too long (max 500 chars)" });
        return;
      }

      // Добавляем сообщение с userId (gameKey уже добавляется в chatService)
      const message = await chatService.addMessage(
        gameKey,
        userId,
        author || "Anonymous",
        text.trim()
      );

      // Отправляем всем в комнате чата
      console.log(`[Chat] Broadcasting message to chat_${gameKey}:`, message.id);
      io.to(`chat_${gameKey}`).emit("NEW_MESSAGE", message);
    } catch (error) {
      console.error("[Chat] Error sending message:", error);
      socket.emit("CHAT_ERROR", { message: "Failed to send message" });
    }
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

  // Очистка старых чатов
  chatService.cleanupOldChats().catch(err =>
    console.error("[Chat] Cleanup error:", err)
  );
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