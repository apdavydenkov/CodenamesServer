const fs = require('fs').promises;
const path = require('path');

/**
 * Сервис для работы с чатом игры
 */
class ChatService {
  constructor(dataDir = 'data') {
    this.dataDir = path.join(__dirname, dataDir);
  }

  /**
   * Получить путь к файлу чата для игры
   */
  getChatFilePath(gameKey) {
    return path.join(this.dataDir, `chat_${gameKey}.json`);
  }

  /**
   * Загрузить историю чата
   */
  async loadChatHistory(gameKey) {
    try {
      const filePath = this.getChatFilePath(gameKey);
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Файл не существует - вернуть пустую структуру
        return {
          gameKey: gameKey,
          messages: [],
          lastUpdated: new Date().toISOString()
        };
      }
      throw error;
    }
  }

  /**
   * Сохранить историю чата
   */
  async saveChatHistory(gameKey, chatData) {
    try {
      // Убедимся что директория существует
      await fs.mkdir(this.dataDir, { recursive: true });

      const filePath = this.getChatFilePath(gameKey);
      await fs.writeFile(filePath, JSON.stringify(chatData, null, 2), 'utf8');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Добавить сообщение в чат
   */
  async addMessage(gameKey, userId, author, text, team = null, role = null) {
    const chatData = await this.loadChatHistory(gameKey);

    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      gameKey: gameKey,
      userId: userId,
      author: author,
      text: text,
      team: team,
      role: role,
      timestamp: new Date().toISOString()
    };

    chatData.messages.push(message);

    // Ограничиваем до 100 последних сообщений
    if (chatData.messages.length > 100) {
      chatData.messages = chatData.messages.slice(-100);
    }

    chatData.lastUpdated = new Date().toISOString();

    await this.saveChatHistory(gameKey, chatData);


    return message;
  }

  /**
   * Обновить имя пользователя во всех его сообщениях
   */
  async updateUsernameInMessages(userId, newUsername) {
    try {
      const files = await fs.readdir(this.dataDir);
      const chatFiles = files.filter(f => f.startsWith('chat_') && f.endsWith('.json'));

      let updatedFilesCount = 0;
      let updatedMessagesCount = 0;

      for (const file of chatFiles) {
        const filePath = path.join(this.dataDir, file);
        const data = await fs.readFile(filePath, 'utf8');
        const chatData = JSON.parse(data);

        let updated = false;
        chatData.messages = chatData.messages.map(msg => {
          if (msg.userId === userId) {
            msg.author = newUsername;
            updated = true;
            updatedMessagesCount++;
          }
          return msg;
        });

        if (updated) {
          await fs.writeFile(filePath, JSON.stringify(chatData, null, 2));
          updatedFilesCount++;
        }
      }

    } catch (error) {
      throw error;
    }
  }

  /**
   * Обновить команду пользователя во всех его сообщениях в конкретной игре
   */
  async updateUserTeamInMessages(gameKey, userId, newTeam, newRole = null) {
    try {
      const chatData = await this.loadChatHistory(gameKey);

      let updated = false;
      chatData.messages = chatData.messages.map(msg => {
        if (msg.userId === userId) {
          msg.team = newTeam;
          if (newRole !== null) {
            msg.role = newRole;
          }
          updated = true;
        }
        return msg;
      });

      if (updated) {
        chatData.lastUpdated = new Date().toISOString();
        await this.saveChatHistory(gameKey, chatData);
      }

      return updated;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Получить историю сообщений
   */
  async getMessages(gameKey, limit = 100) {
    const chatData = await this.loadChatHistory(gameKey);

    // Возвращаем последние N сообщений с добавлением gameKey если его нет
    const messages = chatData.messages.slice(-limit).map(msg => ({
      ...msg,
      gameKey: msg.gameKey || gameKey // Добавляем gameKey для старых сообщений
    }));

    return messages;
  }

  /**
   * Очистка старых файлов чата (старше 7 дней)
   */
  async cleanupOldChats() {
    try {
      const files = await fs.readdir(this.dataDir);
      const chatFiles = files.filter(f => f.startsWith('chat_') && f.endsWith('.json'));

      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 дней

      for (const file of chatFiles) {
        const filePath = path.join(this.dataDir, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
        }
      }
    } catch (error) {
    }
  }
}

module.exports = ChatService;
