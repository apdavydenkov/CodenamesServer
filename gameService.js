const fs = require('fs').promises;
const path = require('path');

/**
 * Сервис для работы с сохранением состояния игр
 */
class GameService {
  constructor(dataDir = 'data') {
    this.dataDir = path.join(__dirname, dataDir);
  }

  /**
   * Получить путь к файлу игры
   */
  getGameFilePath(gameKey) {
    return path.join(this.dataDir, `game_${gameKey}.json`);
  }

  /**
   * Загрузить состояние игры
   */
  async loadGameState(gameKey) {
    try {
      const filePath = this.getGameFilePath(gameKey);
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Файл не существует
        return null;
      }
      throw error;
    }
  }

  /**
   * Сохранить состояние игры
   */
  async saveGameState(gameKey, gameState) {
    try {
      // Убедимся что директория существует
      await fs.mkdir(this.dataDir, { recursive: true });

      const filePath = this.getGameFilePath(gameKey);

      // Конвертируем Map в объект для сохранения
      const stateToSave = {
        gameKey: gameKey,
        ownerId: gameState.ownerId,
        teamsLocked: gameState.teamsLocked,
        isPrivate: gameState.isPrivate,
        teams: {
          blue: {
            captain: gameState.teams.blue.captain,
            captainName: gameState.teams.blue.captainName,
            players: Array.from(gameState.teams.blue.players)
          },
          red: {
            captain: gameState.teams.red.captain,
            captainName: gameState.teams.red.captainName,
            players: Array.from(gameState.teams.red.players)
          },
          spectators: Array.from(gameState.teams.spectators)
        },
        userToTeam: Array.from(gameState.userToTeam.entries()).map(([userId, data]) => ({
          userId,
          team: data.team,
          role: data.role,
          username: data.username
        })),
        revealed: gameState.revealed,
        currentTeam: gameState.currentTeam,
        currentHint: gameState.currentHint,
        simpleMode: gameState.simpleMode,
        gameOver: gameState.gameOver,
        winner: gameState.winner,
        lastUpdated: new Date().toISOString()
      };

      await fs.writeFile(filePath, JSON.stringify(stateToSave, null, 2), 'utf8');
    } catch (error) {
      console.error(`[GameService] Error saving game ${gameKey}:`, error);
      throw error;
    }
  }

  /**
   * Восстановить команды из сохраненного состояния
   */
  restoreTeamsFromSaved(savedState) {
    if (!savedState || !savedState.teams) {
      return null;
    }

    return {
      ownerId: savedState.ownerId,
      teamsLocked: savedState.teamsLocked || false,
      isPrivate: savedState.isPrivate || false,
      teams: {
        blue: {
          captain: savedState.teams.blue.captain,
          captainName: savedState.teams.blue.captainName,
          players: new Set(savedState.teams.blue.players)
        },
        red: {
          captain: savedState.teams.red.captain,
          captainName: savedState.teams.red.captainName,
          players: new Set(savedState.teams.red.players)
        },
        spectators: new Set(savedState.teams.spectators)
      },
      userToTeam: new Map(
        savedState.userToTeam.map(entry => [entry.userId, {
          team: entry.team,
          role: entry.role,
          username: entry.username
        }])
      ),
      revealed: savedState.revealed,
      currentTeam: savedState.currentTeam,
      currentHint: savedState.currentHint || null,
      simpleMode: savedState.simpleMode,
      gameOver: savedState.gameOver,
      winner: savedState.winner
    };
  }

  /**
   * Очистка старых файлов игр (старше 7 дней)
   */
  async cleanupOldGames() {
    try {
      const files = await fs.readdir(this.dataDir);
      const gameFiles = files.filter(f => f.startsWith('game_') && f.endsWith('.json'));

      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 дней

      for (const file of gameFiles) {
        const filePath = path.join(this.dataDir, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          console.log(`[GameService] Cleaned up old game: ${file}`);
        }
      }
    } catch (error) {
      console.error('[GameService] Error cleaning up old games:', error);
    }
  }
}

module.exports = GameService;
