const axios = require('axios');

/**
 * Сервис для работы с ИИ
 */
class AIServerService {
  constructor() {
    this.apiKey = process.env.MISTRAL_API_KEY;
    this.apiUrl = 'https://api.mistral.ai/v1/chat/completions';
  }

  /**
   * Генерация слов по теме через Mistral
   * @param {string} topic - тема для генерации
   * @returns {Promise<string[]>} - массив слов
   */
  async generateWords(topic) {
    if (!this.apiKey) {
      throw new Error('MISTRAL_API_KEY не установлен в переменных окружения');
    }

    const prompt = `Сгенерируй ровно 25 слов для игры "Кодовые имена" по теме: ${topic}

Требования:
- Только существительные в единственном числе
- Одно слово (без пробелов и дефисов)
- Заглавными буквами
- Слова должны быть разнообразными: близкие и далёкие к теме, а также косвенно связанные
- Никаких глаголов и прилагательных
- Реально существующие слова

Формат ответа - СТРОГО JSON массив без дополнительного текста, комментариев и markdown разметки:
["СЛОВО1", "СЛОВО2", "СЛОВО3", ...]`;

    try {
      const response = await axios.post(this.apiUrl, {
        model: 'mistral-medium-2508',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.9,
        max_tokens: 1000
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      const content = response.data.choices[0].message.content.trim();
      console.log('[ИИ] Получен ответ от Mistral:', content.substring(0, 200) + '...');
      
      // Убираем Markdown обёртку если она есть
      let jsonContent = content;
      if (content.includes('```json')) {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          jsonContent = jsonMatch[1].trim();
          console.log('[ИИ] Найдена JSON обёртка, извлекаем содержимое');
        }
      } else if (content.includes('```')) {
        const codeMatch = content.match(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/);
        if (codeMatch) {
          jsonContent = codeMatch[1].trim();
          console.log('[ИИ] Найдена общая обёртка, извлекаем содержимое');
        }
      }
      
      // Парсим JSON ответ
      const words = JSON.parse(jsonContent);
      
      // Проверяем что получили массив из 25 слов
      if (!Array.isArray(words) || words.length !== 25) {
        throw new Error(`Ожидался массив из 25 слов, получено: ${words.length}`);
      }

      // Приводим к верхнему регистру и убираем лишние пробелы
      return words.map(word => word.toString().trim().toUpperCase());

    } catch (error) {
      if (error.response) {
        throw new Error(`Ошибка API Mistral: ${error.response.status} - ${error.response.data?.message || 'Unknown error'}`);
      } else if (error instanceof SyntaxError) {
        throw new Error('Ошибка парсинга JSON ответа от ИИ');
      } else {
        throw new Error(`Ошибка генерации слов: ${error.message}`);
      }
    }
  }
}

module.exports = AIServerService;