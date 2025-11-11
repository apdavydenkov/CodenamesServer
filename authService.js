const fs = require('fs').promises;
const path = require('path');

class AuthService {
  constructor() {
    this.usersFile = path.join(__dirname, 'data', 'users.json');
    this.ensureDataDir();
  }

  async ensureDataDir() {
    const dataDir = path.join(__dirname, 'data');
    try {
      await fs.mkdir(dataDir, { recursive: true });
      try {
        await fs.access(this.usersFile);
      } catch {
        await fs.writeFile(this.usersFile, JSON.stringify({ users: [] }, null, 2));
      }
    } catch (error) {
    }
  }

  async loadUsers() {
    try {
      const data = await fs.readFile(this.usersFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return { users: [] };
    }
  }

  async saveUsers(data) {
    try {
      await fs.writeFile(this.usersFile, JSON.stringify(data, null, 2));
    } catch (error) {
      throw error;
    }
  }

  // Генерация PIN: ABCD-1234-EFGH (4 буквы - 4 цифры - 4 буквы)
  generatePin() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';

    const randomLetters = (count) => {
      let result = '';
      for (let i = 0; i < count; i++) {
        result += letters.charAt(Math.floor(Math.random() * letters.length));
      }
      return result;
    };

    const randomDigits = (count) => {
      let result = '';
      for (let i = 0; i < count; i++) {
        result += digits.charAt(Math.floor(Math.random() * digits.length));
      }
      return result;
    };

    return `${randomLetters(4)}-${randomDigits(4)}-${randomLetters(4)}`;
  }

  // Проверка существования пользователя
  async checkUser(username) {
    const data = await this.loadUsers();
    const user = data.users.find(u => u.username === username);
    return { exists: !!user };
  }

  // Регистрация нового пользователя
  async registerUser(userId, username) {
    // Валидация и санитизация
    const validation = this.validateUsername(username);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const sanitizedName = validation.sanitized;
    const data = await this.loadUsers();

    // Проверяем, не занято ли имя
    if (data.users.find(u => u.username === sanitizedName)) {
      return { success: false, error: 'Имя занято' };
    }

    const pin = this.generatePin();
    const newUser = {
      user_id: userId,
      username: sanitizedName,
      pin: pin,
      joined_date: new Date().toISOString()
    };

    data.users.push(newUser);
    await this.saveUsers(data);

    return { success: true, pin: pin };
  }

  // Проверка PIN-кода
  async verifyPin(username, pin) {
    const data = await this.loadUsers();
    const user = data.users.find(u => u.username === username && u.pin === pin);

    if (user) {
      return {
        success: true,
        user_id: user.user_id,
        username: user.username,
        joined_date: user.joined_date
      };
    }

    return { success: false, error: 'Неверный PIN-код' };
  }

  // Получение пользователя по userId
  async getUser(userId) {
    const data = await this.loadUsers();
    const user = data.users.find(u => u.user_id === userId);

    if (user) {
      return {
        success: true,
        user: {
          user_id: user.user_id,
          username: user.username,
          joined_date: user.joined_date
        }
      };
    }

    return { success: false };
  }

  // Валидация имени пользователя
  validateUsername(username) {
    if (!username || typeof username !== 'string') {
      return { valid: false, error: 'Имя должно быть строкой' };
    }

    const trimmed = username.trim();

    if (trimmed.length < 2 || trimmed.length > 30) {
      return { valid: false, error: 'Имя должно быть от 2 до 30 символов' };
    }

    // Блокируем пробелы и опасные символы: пробел < > & " ' / \ ; = ( ) { } [ ]
    // Разрешены любые Unicode буквы, цифры, дефисы, подчеркивания
    const forbiddenChars = /[\s<>&"'\/\\;=(){}[\]]/;
    if (forbiddenChars.test(trimmed)) {
      return { valid: false, error: 'Имя содержит недопустимые символы (пробелы запрещены)' };
    }

    return { valid: true, sanitized: trimmed };
  }

  // Смена имени пользователя
  async changeName(userId, newUsername) {

    // Валидация и санитизация
    const validation = this.validateUsername(newUsername);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const sanitizedName = validation.sanitized;

    const data = await this.loadUsers();

    // Проверяем, не занято ли новое имя другим пользователем
    const existingUser = data.users.find(u => u.username === sanitizedName && u.user_id !== userId);
    if (existingUser) {
      return { success: false, error: 'Имя уже занято' };
    }

    // Находим пользователя
    const user = data.users.find(u => u.user_id === userId);
    if (!user) {
      return { success: false, error: 'Пользователь не найден' };
    }

    const oldUsername = user.username;
    user.username = sanitizedName;
    await this.saveUsers(data);

    return { success: true, oldUsername, newUsername: sanitizedName };
  }

  // Смена PIN-кода
  async changePin(userId) {
    const data = await this.loadUsers();
    const user = data.users.find(u => u.user_id === userId);

    if (!user) {
      return { success: false, error: 'Пользователь не найден' };
    }

    const newPin = this.generatePin();
    user.pin = newPin;
    await this.saveUsers(data);

    return { success: true, pin: newPin };
  }
}

module.exports = AuthService;
