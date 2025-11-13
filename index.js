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
const GameService = require('./gameService');
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
const gameService = new GameService();

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

// Получение исторических данных
app.get("/stats/history/:period", (req, res) => {
  try {
    const { period } = req.params;
    const { limit, offset } = req.query;
    const history = gameStats.getHistory(period, { limit, offset });
    res.json({ period, count: history.length, data: history });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
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

    // Учитываем только AI-генерацию (игра будет считаться как запущенная при первом ходе)
    gameStats.addAiGeneration();
    console.log("✅ AI game generated (will count as started on first card flip)");

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

    // Учитываем регистрацию в статистике
    if (result.success) {
      gameStats.addUser();
    }

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

    // Новые поля для статистики
    gameStarted: false,       // true после первого REVEAL_CARD
    gameCompleted: false,     // true после завершения (dedupe)
    firstCardTime: null,      // timestamp первого открытия карты
    completionTime: null,     // timestamp завершения игры
    totalMoves: 0,            // количество открытых карт

    // Командная система
    ownerId: null,            // userId создателя игры
    isPrivate: false,         // приватная игра
    teamsLocked: false,       // набор закрыт

    teams: {
      blue: {
        captain: null,        // userId капитана
        captainName: null,    // username капитана
        players: new Set()    // Set из userId игроков
      },
      red: {
        captain: null,
        captainName: null,
        players: new Set()
      },
      spectators: new Set()   // Set из userId наблюдателей
    },

    userToTeam: new Map()     // userId -> { team, role, username }
  };

  if (savedState) {
    game.revealed = savedState.revealed || game.revealed;
    game.currentTeam = savedState.currentTeam || game.currentTeam;
    game.gameOver = savedState.gameOver || game.gameOver;
    game.winner = savedState.winner || game.winner;

    // Восстанавливаем команды
    if (savedState.ownerId) game.ownerId = savedState.ownerId;
    if (savedState.teamsLocked !== undefined) game.teamsLocked = savedState.teamsLocked;
    if (savedState.isPrivate !== undefined) game.isPrivate = savedState.isPrivate;

    if (savedState.teams) {
      game.teams = savedState.teams;
    }

    if (savedState.userToTeam) {
      game.userToTeam = savedState.userToTeam;
    }

    // Если в savedState есть открытые карты, значит игра уже начиналась
    const hasRevealedCards = game.revealed.some(r => r === true);
    if (hasRevealedCards) {
      game.gameStarted = true;
      console.log("⚠️ Restored game with revealed cards - marking as already started (no double-count)");
    }
  }

  calculateDerivedState(game);
  return game;
};

// Helper-функции для командной системы
function getUserTeam(game, userId) {
  return game.userToTeam.get(userId) || null;
}

function hasCaptain(game, team) {
  return game.teams[team].captain !== null;
}

function removeFromTeams(game, userId) {
  if (game.teams.blue.captain === userId) {
    game.teams.blue.captain = null;
    game.teams.blue.captainName = null;
  }
  if (game.teams.red.captain === userId) {
    game.teams.red.captain = null;
    game.teams.red.captainName = null;
  }

  game.teams.blue.players.delete(userId);
  game.teams.red.players.delete(userId);
  game.teams.spectators.delete(userId);
  game.userToTeam.delete(userId);
}

function serializeTeams(game) {
  return {
    blue: {
      captain: game.teams.blue.captain ? {
        userId: game.teams.blue.captain,
        username: game.teams.blue.captainName
      } : null,
      players: Array.from(game.teams.blue.players).map(userId => {
        const info = game.userToTeam.get(userId);
        return info ? { userId, username: info.username } : null;
      }).filter(Boolean)
    },
    red: {
      captain: game.teams.red.captain ? {
        userId: game.teams.red.captain,
        username: game.teams.red.captainName
      } : null,
      players: Array.from(game.teams.red.players).map(userId => {
        const info = game.userToTeam.get(userId);
        return info ? { userId, username: info.username } : null;
      }).filter(Boolean)
    },
    spectators: Array.from(game.teams.spectators).map(userId => {
      const info = game.userToTeam.get(userId);
      return info ? { userId, username: info.username } : null;
    }).filter(Boolean)
  };
}

// Асинхронное сохранение состояния игры
async function saveGameStateAsync(gameKey, game) {
  try {
    await gameService.saveGameState(gameKey, game);
    console.log(`✅ Game state saved: ${gameKey}`);
  } catch (error) {
    console.error(`❌ Error saving game ${gameKey}:`, error);
  }
}

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

  socket.on("JOIN_GAME", async ({ gameKey, words, colors, gameState }) => {
    console.log("\n=== JOIN_GAME ===");
    console.log("Player", socket.id, "joining game:", gameKey);
    console.log("Has words:", !!words);
    console.log("Has colors:", !!colors);
    console.log("Has game state:", !!gameState);

    leaveCurrentGame();

    let game = activeGames.get(gameKey);

    if (!game && words && colors) {
      console.log("Creating new game state");

      // Пытаемся загрузить сохраненное состояние команд
      const savedGameState = await gameService.loadGameState(gameKey);
      if (savedGameState) {
        console.log("✅ Found saved game state, restoring teams");
        const restoredData = gameService.restoreTeamsFromSaved(savedGameState);
        if (restoredData) {
          gameState = { ...gameState, ...restoredData };
        }
      }

      game = createNewGameState(gameKey, words, colors, gameState);
      activeGames.set(gameKey, game);
      gameStats.addActiveGame(gameKey); // Добавляем в активные игры
      console.log("✅ Added to active games count");
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

      // Отправить состояние игры с командами
      const state = {
        words: game.words,
        colors: game.colors,
        revealed: game.revealed,
        currentTeam: game.currentTeam,
        remainingCards: game.remainingCards,
        gameOver: game.gameOver,
        winner: game.winner,
        teams: serializeTeams(game),
        ownerId: game.ownerId,
        isPrivate: game.isPrivate,
        teamsLocked: game.teamsLocked
      };

      io.to(gameKey).emit("GAME_STATE", state);

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
    gameStats.addActiveGame(gameKey); // Добавляем в активные игры
    console.log("✅ Added to active games count");

    socket.join(gameKey);
    currentGame = gameKey;
    game.players.add(socket.id);

    console.log("Game created successfully");
    console.log("First player:", socket.id);

    // Отправить состояние игры с командами
    const state = {
      words: game.words,
      colors: game.colors,
      revealed: game.revealed,
      currentTeam: game.currentTeam,
      remainingCards: game.remainingCards,
      gameOver: game.gameOver,
      winner: game.winner,
      teams: serializeTeams(game),
      ownerId: game.ownerId,
      isPrivate: game.isPrivate,
      teamsLocked: game.teamsLocked
    };

    io.to(gameKey).emit("GAME_STATE", state);
    console.log("=== END NEW_GAME ===\n");
  });

  // JOIN_TEAM - присоединение к команде
  socket.on("JOIN_TEAM", async ({ gameKey, team, role, userId, username }) => {
    console.log(`\n┌─ JOIN_TEAM ────────────────────────────────`);
    console.log(`│ User: ${username} (${userId})`);
    console.log(`│ Team: ${team}, Role: ${role}`);
    console.log(`│ Game: ${gameKey}`);

    const game = activeGames.get(gameKey);
    if (!game) {
      socket.emit("GAME_ERROR", { message: "Игра не найдена", code: "GAME_NOT_FOUND" });
      return;
    }

    // Проверка: набор закрыт?
    if (game.teamsLocked && game.ownerId !== userId) {
      socket.emit("GAME_ERROR", { message: "Набор в команды закрыт", code: "TEAMS_LOCKED" });
      return;
    }

    // Удалить из предыдущей команды
    removeFromTeams(game, userId);

    // Наблюдатель
    if (team === "spectator") {
      game.teams.spectators.add(userId);
      game.userToTeam.set(userId, { team: "spectator", role: "spectator", username });

      const msg = `Я стал наблюдателем`;
      const savedMsg = await chatService.addMessage(gameKey, userId, username, msg, 'spectator', 'spectator');
      io.to(`chat_${gameKey}`).emit("NEW_MESSAGE", savedMsg);

      io.to(gameKey).emit("TEAMS_UPDATE", { teams: serializeTeams(game) });
      socket.emit("JOIN_TEAM_SUCCESS", { team, role: "spectator" });
      console.log(`└─ ✅ SUCCESS: Joined as spectator`);

      // Сохраняем состояние игры
      saveGameStateAsync(gameKey, game);
      return;
    }

    // Капитан
    if (role === "captain") {
      if (hasCaptain(game, team)) {
        socket.emit("GAME_ERROR", {
          message: "Капитан этой команды уже выбран",
          code: "CAPTAIN_TAKEN"
        });

        // Автоматически сделать игроком
        game.teams[team].players.add(userId);
        game.userToTeam.set(userId, { team, role: "player", username });

        io.to(gameKey).emit("TEAMS_UPDATE", { teams: serializeTeams(game) });
        socket.emit("JOIN_TEAM_SUCCESS", { team, role: "player" });

        const teamRu = team === "blue" ? "синюю" : "красную";
        const msg = `Я вступил в ${teamRu} команду`;
        const savedMsg = await chatService.addMessage(gameKey, userId, username, msg, team, 'player');
        io.to(`chat_${gameKey}`).emit("NEW_MESSAGE", savedMsg);

        // Сохраняем состояние игры
        saveGameStateAsync(gameKey, game);

        console.log(`⚠️ Captain taken, ${username} joined as player`);
        return;
      }

      game.teams[team].captain = userId;
      game.teams[team].captainName = username;
      game.userToTeam.set(userId, { team, role: "captain", username });

      const teamRu = team === "blue" ? "синей" : "красной";
      const msg = `Я стал капитаном ${teamRu} команды`;
      const savedMsg = await chatService.addMessage(gameKey, userId, username, msg, team, 'captain');
      io.to(`chat_${gameKey}`).emit("NEW_MESSAGE", savedMsg);

      // Сохраняем состояние игры
      saveGameStateAsync(gameKey, game);

      io.to(gameKey).emit("TEAMS_UPDATE", { teams: serializeTeams(game) });
      socket.emit("JOIN_TEAM_SUCCESS", { team, role: "captain" });
      console.log(`✅ ${username} became captain of ${team}`);
      return;
    }

    // Обычный игрок
    if (role === "player") {
      game.teams[team].players.add(userId);
      game.userToTeam.set(userId, { team, role: "player", username });

      const teamRu = team === "blue" ? "синюю" : "красную";
      const msg = `Я вступил в ${teamRu} команду`;
      const savedMsg = await chatService.addMessage(gameKey, userId, username, msg, team, 'player');
      io.to(`chat_${gameKey}`).emit("NEW_MESSAGE", savedMsg);

      // Сохраняем состояние игры
      saveGameStateAsync(gameKey, game);

      io.to(gameKey).emit("TEAMS_UPDATE", { teams: serializeTeams(game) });
      socket.emit("JOIN_TEAM_SUCCESS", { team, role: "player" });
      console.log(`✅ ${username} joined ${team} team as player`);
    }
  });

  // LEAVE_CAPTAIN - снять капитанство
  socket.on("LEAVE_CAPTAIN", async ({ gameKey, userId }) => {
    console.log(`\n=== LEAVE_CAPTAIN: userId=${userId} ===`);

    const game = activeGames.get(gameKey);
    if (!game) {
      socket.emit("GAME_ERROR", { message: "Игра не найдена", code: "GAME_NOT_FOUND" });
      return;
    }

    const userTeam = getUserTeam(game, userId);
    if (!userTeam || userTeam.role !== "captain") {
      socket.emit("GAME_ERROR", { message: "Вы не капитан", code: "NOT_CAPTAIN" });
      return;
    }

    const team = userTeam.team;

    // Снять капитанство
    game.teams[team].captain = null;
    game.teams[team].captainName = null;

    // Стать игроком
    game.teams[team].players.add(userId);
    game.userToTeam.set(userId, { team, role: "player", username: userTeam.username });

    const teamRu = team === "blue" ? "синей" : "красной";
    const msg = `Я снял с себя полномочия капитана. Роль капитана ${teamRu} команды свободна.`;
    // Сохраняем состояние игры
    saveGameStateAsync(gameKey, game);

    const savedMsg = await chatService.addMessage(gameKey, userId, userTeam.username, msg, team, 'player');
    io.to(`chat_${gameKey}`).emit("NEW_MESSAGE", savedMsg);

    io.to(gameKey).emit("TEAMS_UPDATE", { teams: serializeTeams(game) });
    socket.emit("LEAVE_CAPTAIN_SUCCESS", { team, role: "player" });
    console.log(`✅ ${userTeam.username} left captain role`);
  });

  // LOCK_TEAMS - закрыть/открыть набор в команды
  socket.on("LOCK_TEAMS", async ({ gameKey, userId }) => {
    console.log(`\n=== LOCK_TEAMS: userId=${userId} ===`);

    const game = activeGames.get(gameKey);
    if (!game || game.ownerId !== userId) {
      console.log(`⚠️ Not owner or game not found`);
      return;
    }

    game.teamsLocked = !game.teamsLocked;

    const msg = game.teamsLocked ? "Набор в команды закрыт" : "Набор в команды открыт";
    const savedMsg = await chatService.addMessage(gameKey, null, "Система", msg);
    io.to(`chat_${gameKey}`).emit("NEW_MESSAGE", savedMsg);

    io.to(gameKey).emit("GAME_SETTINGS_UPDATE", { teamsLocked: game.teamsLocked });

    // Сохраняем состояние игры
    saveGameStateAsync(gameKey, game);

    console.log(`✅ Teams locked: ${game.teamsLocked}`);
  });

  // SET_PRIVATE - сделать игру приватной/публичной
  socket.on("SET_PRIVATE", async ({ gameKey, userId, isPrivate }) => {
    console.log(`\n=== SET_PRIVATE: userId=${userId}, isPrivate=${isPrivate} ===`);

    const game = activeGames.get(gameKey);
    if (!game || game.ownerId !== userId) {
      console.log(`⚠️ Not owner or game not found`);
      return;
    }

    game.isPrivate = isPrivate;

    const msg = isPrivate ? "Игра стала приватной" : "Игра стала публичной";
    const savedMsg = await chatService.addMessage(gameKey, null, "Система", msg);
    io.to(`chat_${gameKey}`).emit("NEW_MESSAGE", savedMsg);

    io.to(gameKey).emit("GAME_SETTINGS_UPDATE", { isPrivate: game.isPrivate });

    // Сохраняем состояние игры
    saveGameStateAsync(gameKey, game);

    console.log(`✅ Game private: ${game.isPrivate}`);
  });

  socket.on("REVEAL_CARD", async ({ gameKey, cardIndex, userId, username }) => {
    console.log("\n=== REVEAL_CARD ===");
    console.log("Game key:", gameKey);
    console.log("Card index:", cardIndex);
    console.log("User ID:", userId);
    console.log("Username:", username);
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

    // ПРОВЕРКИ КОМАНДЫ/РОЛИ
    const userTeam = getUserTeam(game, userId);
    console.log("User team:", userTeam);

    // Проверка 1: Игрок выбрал команду
    if (!userTeam || userTeam.team === "spectator") {
      console.log("❌ User has no team or is spectator");
      socket.emit("GAME_ERROR", {
        message: "Выберите команду для участия в игре",
        code: "NO_TEAM"
      });
      return;
    }

    // Проверка 2: Капитаны не могут открывать карточки
    if (userTeam.role === "captain") {
      console.log("❌ Captain cannot reveal cards");
      socket.emit("GAME_ERROR", {
        message: "Капитаны не могут открывать карточки",
        code: "CAPTAIN_CANNOT_REVEAL"
      });
      return;
    }

    // Проверка 3: Это ход команды игрока
    if (userTeam.team !== game.currentTeam) {
      console.log(`❌ Not user's team turn (user: ${userTeam.team}, current: ${game.currentTeam})`);
      socket.emit("GAME_ERROR", {
        message: "Сейчас ход другой команды",
        code: "NOT_YOUR_TURN"
      });
      return;
    }

    console.log("✅ All checks passed, revealing card");

    // Первый ход - игра началась
    if (!game.gameStarted) {
      game.gameStarted = true;
      game.firstCardTime = Date.now();
      game.totalMoves = 0;
      gameStats.addGame(gameKey);
      console.log("🎮 Game started! First card opened");
    }

    game.revealed[cardIndex] = true;
    game.totalMoves++;
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

    // Системное сообщение в чат
    const wordRevealed = game.words[cardIndex];
    const teamRu = userTeam.team === "blue" ? "синей" : "красной";
    const colorRu = {
      blue: "синюю",
      red: "красную",
      black: "чёрную",
      neutral: "нейтральную"
    }[cardColor];

    const wordCleaned = wordRevealed.replace(/\u00AD/g, ''); // Убрать мягкие переносы
    const moveMessage = `Я открыл ${colorRu} карточку: ${wordCleaned}`;
    const savedMsg = await chatService.addMessage(gameKey, userId, username, moveMessage, userTeam.team, userTeam.role);
    io.to(`chat_${gameKey}`).emit("NEW_MESSAGE", savedMsg);
    console.log(`[Chat] Move message from ${username}: ${moveMessage}`);

    // Игра завершена (с dedupe)
    if (game.gameOver && !game.gameCompleted) {
      game.gameCompleted = true;
      game.completionTime = Date.now();
      const duration = game.completionTime - game.firstCardTime;
      gameStats.completeGame(gameKey, duration, game.totalMoves);
      console.log(`🏆 Game completed! Winner: ${game.winner}, Duration: ${Math.floor(duration / 1000)}s, Moves: ${game.totalMoves}`);
    }

    const state = {
      words: game.words,
      colors: game.colors,
      revealed: game.revealed,
      currentTeam: game.currentTeam,
      remainingCards: game.remainingCards,
      gameOver: game.gameOver,
      winner: game.winner,
      teams: serializeTeams(game),
      ownerId: game.ownerId,
      isPrivate: game.isPrivate,
      teamsLocked: game.teamsLocked
    };

    io.to(gameKey).emit("GAME_STATE", state);
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

      // Получаем команду и роль пользователя
      let userTeam = null;
      let userRole = null;
      const game = activeGames.get(gameKey);
      if (game) {
        const teamInfo = game.userToTeam.get(userId);
        if (teamInfo) {
          userTeam = teamInfo.team;
          userRole = teamInfo.role;
          console.log(`[Chat] User ${author} is in team: ${userTeam}, role: ${userRole}`);
        } else {
          console.log(`[Chat] User ${author} has no team assigned`);
        }
      } else {
        console.log(`[Chat] Game ${gameKey} not found in activeGames`);
      }

      // Добавляем сообщение с userId, team и role
      const message = await chatService.addMessage(
        gameKey,
        userId,
        author || "Anonymous",
        text.trim(),
        userTeam,
        userRole
      );

      // Учитываем сообщение в статистике
      gameStats.addChatMessage();

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
      gameStats.removeActiveGame(key);
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