const fs = require('fs').promises;
const path = require('path');

class StatsRepository {
  async load() {
    throw new Error('Method must be implemented');
  }
  
  async save(stats) {
    throw new Error('Method must be implemented');
  }
}

class FileStatsRepository extends StatsRepository {
  constructor(filePath) {
    super();
    this.filePath = filePath;
  }
  
  async load() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
  
  async save(stats) {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(stats, null, 2));
  }
}

class StatsPeriodManager {
  static getCurrentHour() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}`;
  }

  static getToday() {
    return new Date().toISOString().split('T')[0];
  }

  static getWeekStart(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().split('T')[0];
  }

  static getCurrentMonth() {
    const now = new Date();
    return {
      month: now.getMonth() + 1,
      year: now.getFullYear()
    };
  }

  // Вспомогательные методы для работы с датами
  static parseHour(hourStr) {
    // "2025-11-11T23" → Date object
    return new Date(hourStr + ':00:00Z');
  }

  static addHours(hourStr, hours) {
    const date = this.parseHour(hourStr);
    date.setHours(date.getHours() + hours);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}`;
  }

  static getHoursDifference(fromHour, toHour) {
    const from = this.parseHour(fromHour);
    const to = this.parseHour(toHour);
    return Math.floor((to - from) / (1000 * 60 * 60));
  }

  static addDays(dateStr, days) {
    const date = new Date(dateStr + 'T00:00:00Z');
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  static getDaysDifference(fromDate, toDate) {
    const from = new Date(fromDate + 'T00:00:00Z');
    const to = new Date(toDate + 'T00:00:00Z');
    return Math.floor((to - from) / (1000 * 60 * 60 * 24));
  }

  static createEmptyPeriodStats() {
    return {
      gamesStarted: 0,
      gamesCompleted: 0,
      usersRegistered: 0,
      chatMessagesSent: 0,
      aiGamesGenerated: 0
    };
  }
  
  static createInitialStats() {
    const now = new Date();
    const currentMonth = this.getCurrentMonth();

    return {
      hourly: {
        hour: this.getCurrentHour(),
        ...this.createEmptyPeriodStats()
      },
      daily: {
        date: this.getToday(),
        ...this.createEmptyPeriodStats()
      },
      weekly: {
        startDate: this.getWeekStart(),
        ...this.createEmptyPeriodStats()
      },
      monthly: {
        month: currentMonth.month,
        year: currentMonth.year,
        ...this.createEmptyPeriodStats()
      },
      history: {
        hours: [],   // последние 168 часов (7 дней)
        days: [],    // последние 90 дней
        weeks: [],   // последние 52 недели
        months: []   // последние 24 месяца
      },
      allTime: {
        totalGamesStarted: 0,
        totalGamesCompleted: 0,
        totalUsers: 0,
        totalMessagesSent: 0,
        totalAiGamesGenerated: 0,
        serverStartTime: now.toISOString()
      }
    };
  }
  
  static shouldResetPeriod(currentStats) {
    const currentHour = this.getCurrentHour();
    const today = this.getToday();
    const weekStart = this.getWeekStart();
    const currentMonth = this.getCurrentMonth();

    return {
      hourly: currentStats.hourly.hour !== currentHour,
      daily: currentStats.daily.date !== today,
      weekly: currentStats.weekly.startDate !== weekStart,
      monthly: currentStats.monthly.month !== currentMonth.month ||
               currentStats.monthly.year !== currentMonth.year
    };
  }
  
  static resetPeriods(stats, resetFlags) {
    const newStats = { ...stats };

    // Архивируем hourly перед сбросом
    if (resetFlags.hourly && stats.hourly) {
      newStats.history = newStats.history || { hours: [], days: [], weeks: [], months: [] };

      const lastHour = stats.hourly.hour;
      const currentHour = this.getCurrentHour();
      const hoursDiff = this.getHoursDifference(lastHour, currentHour);

      // Архивируем последний известный час
      newStats.history.hours.push({ ...stats.hourly });

      // Заполняем пропущенные часы нулями (если разница > 1)
      if (hoursDiff > 1) {
        for (let i = 1; i < hoursDiff; i++) {
          const gapHour = this.addHours(lastHour, i);
          newStats.history.hours.push({
            hour: gapHour,
            ...this.createEmptyPeriodStats()
          });
        }
      }

      newStats.history.hours = this.pruneHistory(newStats.history.hours, 168); // 7 дней

      newStats.hourly = {
        hour: currentHour,
        ...this.createEmptyPeriodStats()
      };
    }

    // Архивируем daily перед сбросом
    if (resetFlags.daily && stats.daily) {
      newStats.history = newStats.history || { hours: [], days: [], weeks: [], months: [] };

      const lastDate = stats.daily.date;
      const currentDate = this.getToday();
      const daysDiff = this.getDaysDifference(lastDate, currentDate);

      // Архивируем последний известный день
      newStats.history.days.push({ ...stats.daily });

      // Заполняем пропущенные дни нулями (если разница > 1)
      if (daysDiff > 1) {
        for (let i = 1; i < daysDiff; i++) {
          const gapDate = this.addDays(lastDate, i);
          newStats.history.days.push({
            date: gapDate,
            ...this.createEmptyPeriodStats()
          });
        }
      }

      newStats.history.days = this.pruneHistory(newStats.history.days, 90); // 90 дней

      newStats.daily = {
        date: currentDate,
        ...this.createEmptyPeriodStats()
      };
    }

    // Архивируем weekly перед сбросом
    if (resetFlags.weekly && stats.weekly) {
      newStats.history = newStats.history || { hours: [], days: [], weeks: [], months: [] };
      newStats.history.weeks.push({ ...stats.weekly });
      newStats.history.weeks = this.pruneHistory(newStats.history.weeks, 52); // 52 недели

      newStats.weekly = {
        startDate: this.getWeekStart(),
        ...this.createEmptyPeriodStats()
      };
    }

    // Архивируем monthly перед сбросом
    if (resetFlags.monthly && stats.monthly) {
      newStats.history = newStats.history || { hours: [], days: [], weeks: [], months: [] };
      newStats.history.months.push({ ...stats.monthly });
      newStats.history.months = this.pruneHistory(newStats.history.months, 24); // 24 месяца

      const currentMonth = this.getCurrentMonth();
      newStats.monthly = {
        month: currentMonth.month,
        year: currentMonth.year,
        ...this.createEmptyPeriodStats()
      };
    }

    return newStats;
  }

  static pruneHistory(history, limit) {
    // Обрезаем массив до нужного размера (оставляем последние N элементов)
    if (history.length > limit) {
      return history.slice(-limit);
    }
    return history;
  }
}

class GameStatsService {
  constructor(repository) {
    this.repository = repository;
    this.stats = null;
    this.activeGamesCount = 0;
    this.isDirty = false;
    this.saveInterval = null;
    
    this.initialize();
  }
  
  async initialize() {
    await this.loadStats();
    this.startPeriodicSave();
  }
  
  async loadStats() {
    try {
      this.stats = await this.repository.load();
      
      if (!this.stats) {
        this.stats = StatsPeriodManager.createInitialStats();
        await this.saveStats();
      } else {
        this.checkAndResetPeriods();
      }
    } catch (error) {
      this.stats = StatsPeriodManager.createInitialStats();
    }
  }
  
  checkAndResetPeriods() {
    const resetFlags = StatsPeriodManager.shouldResetPeriod(this.stats);
    const needsReset = Object.values(resetFlags).some(flag => flag);
    
    if (needsReset) {
      this.stats = StatsPeriodManager.resetPeriods(this.stats, resetFlags);
      this.markDirty();
    }
  }
  
  markDirty() {
    this.isDirty = true;
  }
  
  async saveStats() {
    if (!this.stats) return;
    
    try {
      await this.repository.save(this.stats);
      this.isDirty = false;
    } catch (error) {
    }
  }
  
  startPeriodicSave() {
    this.saveInterval = setInterval(async () => {
      if (this.isDirty) {
        await this.saveStats();
      }
    }, 30000);
  }
  
  stopPeriodicSave() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
  }
  
  addActiveGame(gameKey) {
    this.activeGamesCount++;
  }

  removeActiveGame(gameKey) {
    this.activeGamesCount--;
  }

  addGame(gameKey) {
    this.checkAndResetPeriods();
    this.stats.hourly.gamesStarted++;
    this.stats.daily.gamesStarted++;
    this.stats.weekly.gamesStarted++;
    this.stats.monthly.gamesStarted++;
    this.stats.allTime.totalGamesStarted++;
    this.markDirty();
  }
  
  completeGame(gameKey, duration, moves) {
    this.checkAndResetPeriods();
    this.stats.hourly.gamesCompleted++;
    this.stats.daily.gamesCompleted++;
    this.stats.weekly.gamesCompleted++;
    this.stats.monthly.gamesCompleted++;
    this.stats.allTime.totalGamesCompleted++;
    this.markDirty();
  }

  addUser() {
    this.checkAndResetPeriods();
    this.stats.hourly.usersRegistered++;
    this.stats.daily.usersRegistered++;
    this.stats.weekly.usersRegistered++;
    this.stats.monthly.usersRegistered++;
    this.stats.allTime.totalUsers++;
    this.markDirty();
  }

  addChatMessage() {
    this.checkAndResetPeriods();
    this.stats.hourly.chatMessagesSent++;
    this.stats.daily.chatMessagesSent++;
    this.stats.weekly.chatMessagesSent++;
    this.stats.monthly.chatMessagesSent++;
    this.stats.allTime.totalMessagesSent++;
    this.markDirty();
  }

  addAiGeneration() {
    this.checkAndResetPeriods();
    this.stats.hourly.aiGamesGenerated++;
    this.stats.daily.aiGamesGenerated++;
    this.stats.weekly.aiGamesGenerated++;
    this.stats.monthly.aiGamesGenerated++;
    this.stats.allTime.totalAiGamesGenerated++;
    this.markDirty();
  }
  
  getStats() {
    this.checkAndResetPeriods();

    return {
      activeGames: this.activeGamesCount,
      uptime: Math.floor(process.uptime()),
      ...this.stats
    };
  }

  getHistory(period, { limit, offset } = {}) {
    if (!this.stats || !this.stats.history) {
      return [];
    }

    const validPeriods = ['hours', 'days', 'weeks', 'months'];
    if (!validPeriods.includes(period)) {
      throw new Error(`Invalid period. Must be one of: ${validPeriods.join(', ')}`);
    }

    let history = this.stats.history[period] || [];

    // Применяем offset и limit
    if (offset) {
      history = history.slice(parseInt(offset));
    }

    if (limit) {
      history = history.slice(0, parseInt(limit));
    }

    return history;
  }
  
  async shutdown() {
    this.stopPeriodicSave();
    if (this.isDirty) {
      await this.saveStats();
    }
  }
}

class GameStatsFactory {
  static create(dataDir = 'data') {
    const statsFilePath = path.join(__dirname, dataDir, 'stats.json');
    const repository = new FileStatsRepository(statsFilePath);
    return new GameStatsService(repository);
  }
}

module.exports = {
  GameStatsFactory
};