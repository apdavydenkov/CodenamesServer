const fs = require('fs').promises;
const path = require('path');

/**
 * Сервис для работы с файлом ai_games.json
 */
class AIGamesFileService {
  constructor() {
    // Путь к файлу ai_games.json во frontend/public/dic/
    this.filePath = path.join(__dirname, '..', 'frontend', 'public', 'dic', 'ai_games.json');
  }

  /**
   * Загрузка всех ИИ-игр из файла
   * @returns {Promise<Object>} - объект с играми
   */
  async loadGames() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Файл не существует, возвращаем пустой объект
        return {};
      }
      throw new Error(`Ошибка чтения файла ai_games.json: ${error.message}`);
    }
  }

  /**
   * Сохранение игр в файл
   * @param {Object} games - объект с играми
   */
  async saveGames(games) {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(games, null, 2), 'utf8');
    } catch (error) {
      throw new Error(`Ошибка записи файла ai_games.json: ${error.message}`);
    }
  }

  /**
   * Добавление новой игры
   * @param {string} key - ключ игры
   * @param {string[]} words - массив слов
   * @param {string} topic - тема игры
   */
  async addGame(key, words, topic) {
    const games = await this.loadGames();
    
    games[key] = {
      words: words,
      topic: topic,
      created: new Date().toISOString()
    };
    
    await this.saveGames(games);
  }

  /**
   * Проверка существования игры по ключу
   * @param {string} key - ключ игры
   * @returns {Promise<boolean>}
   */
  async gameExists(key) {
    const games = await this.loadGames();
    return games.hasOwnProperty(key);
  }
}

module.exports = AIGamesFileService;