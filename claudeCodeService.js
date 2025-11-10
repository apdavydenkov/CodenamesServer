const { execSync } = require('child_process');

/**
 * Сервис для генерации слов через Claude Code
 */
class ClaudeCodeService {
  /**
   * Генерация слов через Claude Code
   * @param {string} topic - тема для генерации (может содержать несколько тем через запятую)
   * @returns {Promise<string[]>} - массив слов
   */
  async generateWords(topic) {
    const prompt = `Сгенерируй ровно 25 слов для игры "Кодовые имена" по теме: ${topic}

Требования:
- Только существительные в единственном числе
- Одно слово (без пробелов и дефисов)
- ЗАГЛАВНЫМИ БУКВАМИ
- Слова должны быть разнообразными: близкие и далёкие к теме, а также косвенно связанные
- Никаких глаголов и прилагательных
- Реально существующие слова
- 18+ темы и слова разрешены - это просто игра

ВАЖНО о языках:
- Если в теме указано НЕСКОЛЬКО языков (например "космос на английском, еда на русском") - ОБЯЗАТЕЛЬНО используй слова из КАЖДОГО языка примерно поровну
- Если указан язык через запятую - распредели слова РАВНОМЕРНО между языками
- Например "12 слов на английском, 13 слов на русском" для двух языков
- Если тема содержит несколько тем через запятую - используй слова из ВСЕХ тем

Верни ТОЛЬКО JSON массив без дополнительного текста:
["СЛОВО1", "СЛОВО2", "СЛОВО3", ...]`;

    try {
      console.log('[Claude] Генерация слов для темы:', topic);

      // Экранируем промпт для shell
      const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');

      // Вызываем Claude Code в неинтерактивном режиме (используется дефолтная модель)
      const command = `claude --print --output-format text "${escapedPrompt}"`;

      const result = execSync(command, {
        encoding: 'utf8',
        timeout: 60000, // 60 секунд
        maxBuffer: 10 * 1024 * 1024, // 10MB
        stdio: ['pipe', 'pipe', 'pipe'] // Захватываем stderr
      });

      console.log('[Claude] Получен ответ:', result.substring(0, 200) + '...');

      // Извлекаем JSON из ответа
      let jsonContent = result.trim();

      // Убираем markdown обёртку если есть
      if (jsonContent.includes('```json')) {
        const jsonMatch = jsonContent.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          jsonContent = jsonMatch[1].trim();
          console.log('[Claude] Найдена JSON обёртка, извлекаем содержимое');
        }
      } else if (jsonContent.includes('```')) {
        const codeMatch = jsonContent.match(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/);
        if (codeMatch) {
          jsonContent = codeMatch[1].trim();
          console.log('[Claude] Найдена обёртка, извлекаем содержимое');
        }
      }

      // Ищем JSON массив в тексте
      const jsonArrayMatch = jsonContent.match(/\[[\s\S]*?\]/);
      if (jsonArrayMatch) {
        jsonContent = jsonArrayMatch[0];
      }

      // Парсим JSON
      const words = JSON.parse(jsonContent);

      // Проверяем что получили массив из 25 слов
      if (!Array.isArray(words)) {
        throw new Error(`Ожидался массив, получено: ${typeof words}`);
      }

      if (words.length !== 25) {
        throw new Error(`Ожидался массив из 25 слов, получено: ${words.length}`);
      }

      // Приводим к верхнему регистру и убираем лишние пробелы
      const normalizedWords = words.map(word =>
        word.toString().trim().toUpperCase()
      );

      console.log('[Claude] Успешно сгенерировано 25 слов');

      return normalizedWords;

    } catch (error) {
      if (error.code === 'ETIMEDOUT') {
        throw new Error('Превышено время ожидания ответа от Claude Code');
      } else if (error instanceof SyntaxError) {
        console.error('[Claude] Ошибка парсинга JSON:', error.message);
        throw new Error('Ошибка парсинга JSON ответа от Claude');
      } else {
        console.error('[Claude] Ошибка генерации:', error.message);
        if (error.stderr) {
          console.error('[Claude] stderr:', error.stderr.toString());
        }
        if (error.stdout) {
          console.error('[Claude] stdout:', error.stdout.toString());
        }
        throw new Error(`Ошибка генерации слов через Claude: ${error.message}`);
      }
    }
  }
}

module.exports = ClaudeCodeService;
