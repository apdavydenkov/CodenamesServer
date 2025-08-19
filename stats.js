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
  
  static createEmptyPeriodStats() {
    return {
      gamesCreated: 0,
      gamesCompleted: 0
    };
  }
  
  static createInitialStats() {
    const now = new Date();
    const currentMonth = this.getCurrentMonth();
    
    return {
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
      allTime: {
        totalGames: 0,
        serverStartTime: now.toISOString()
      }
    };
  }
  
  static shouldResetPeriod(currentStats) {
    const today = this.getToday();
    const weekStart = this.getWeekStart();
    const currentMonth = this.getCurrentMonth();
    
    return {
      daily: currentStats.daily.date !== today,
      weekly: currentStats.weekly.startDate !== weekStart,
      monthly: currentStats.monthly.month !== currentMonth.month || 
               currentStats.monthly.year !== currentMonth.year
    };
  }
  
  static resetPeriods(stats, resetFlags) {
    const newStats = { ...stats };
    
    if (resetFlags.daily) {
      newStats.daily = {
        date: this.getToday(),
        ...this.createEmptyPeriodStats()
      };
    }
    
    if (resetFlags.weekly) {
      newStats.weekly = {
        startDate: this.getWeekStart(),
        ...this.createEmptyPeriodStats()
      };
    }
    
    if (resetFlags.monthly) {
      const currentMonth = this.getCurrentMonth();
      newStats.monthly = {
        month: currentMonth.month,
        year: currentMonth.year,
        ...this.createEmptyPeriodStats()
      };
    }
    
    return newStats;
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
      console.error('Error loading stats:', error);
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
      console.error('Error saving stats:', error);
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
  
  addGame(gameKey) {
    this.activeGamesCount++;
    this.checkAndResetPeriods();
    this.stats.daily.gamesCreated++;
    this.stats.weekly.gamesCreated++;
    this.stats.monthly.gamesCreated++;
    this.stats.allTime.totalGames++;
    this.markDirty();
  }
  
  removeGame(gameKey) {
    this.activeGamesCount--;
  }
  
  completeGame(gameKey) {
    this.checkAndResetPeriods();
    this.stats.daily.gamesCompleted++;
    this.stats.weekly.gamesCompleted++;
    this.stats.monthly.gamesCompleted++;
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
  GameStatsService,
  FileStatsRepository,
  StatsPeriodManager,
  GameStatsFactory
};