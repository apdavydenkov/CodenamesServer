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

ОСНОВНЫЕ ТРЕБОВАНИЯ:
- Ровно 25 слов (без больше, без меньше)
- Только существительные в единственном числе
- Одно слово на элемент (без пробелов и дефисов)
- Заглавными буквами (или иероглифами для иероглифных языков)
- Слова должны быть разнообразными: близкие и далёкие к теме, а также косвенно связанные
- Никаких глаголов и прилагательных
- Реально существующие слова
- 18+ темы и слова разрешены - это просто игра

ПРАВИЛА ДЛЯ ЯЗЫКОВ И ТЕМ:
1. ЯЗЫКИ: Если в теме указаны языки (например "на английском и русском", "英文和中文"):
   - Игнорируй язык самого запроса
   - ОБЯЗАТЕЛЬНО используй ТОЛЬКО указанные языки, НИ КАКИЕ ДРУГИЕ!
   - Распредели 25 слов РАВНОМЕРНО между всеми языками
   - Пример для 2 языков: 13 слов на первом языке, 12 на втором языке
   - Пример для 3 языков: 9 слов на первом, 8 на втором, 8 на третьем
   - КРИТИЧНО: Каждый язык должен быть представлен своим СОБСТВЕННЫМ письмом, не путай языки!
   - Например: корейский = хангыль, вьетнамский = вьетнамский (с диакритиками ă â ê ô ơ ư đ), русский = кириллица и т.д.
   - НИКОГДА не используй письмо одного языка для другого языка!

2. ТЕМЫ: Если в теме указаны несколько тем через запятую или "и":
   - Используй слова из ВСЕХ тем
   - Распредели 25 слов РАВНОМЕРНО между всеми темами
   - Пример для 2 тем: 13 слов на первую, 12 на вторую

3. КОМБИНАЦИЯ: Если указаны И несколько языков И несколько тем:
   - Комбинируй оба условия одновременно
   - Пример: 2 темы × 2 языка = 4 комбинации, примерно по 6 слов на каждую

4. БЕЗ УКАЗАНИЯ ЯЗЫКОВ: Если языки не указаны явно:
   - Используй язык самого запроса
   - Если запрос на русском - на русском, на английском - на английском и т.д.

ФОРМАТ ВЫВОДА:
- НИКОГДА НЕ ИСПОЛЬЗУЙ ЛАТИНСКУЮ ТРАНСЛИТЕРАЦИЮ
- ВСЕГДА используй ОРИГИНАЛЬНЫЕ СИМВОЛЫ каждого языка - не перепутай письменности между языками!
- Каждый язык имеет свою уникальную письменность, не смешивай их

Верни ТОЛЬКО JSON массив без дополнительного текста, комментариев или markdown разметки:
["СЛОВО1", "СЛОВО2", "СЛОВО3", ...]`;

    try {
      const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      const command = `claude --print --output-format text --model claude-haiku-4-5-20251001 "${escapedPrompt}"`;

      const result = execSync(command, {
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let jsonContent = result.trim();

      if (jsonContent.includes('```json')) {
        const jsonMatch = jsonContent.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          jsonContent = jsonMatch[1].trim();
        }
      } else if (jsonContent.includes('```')) {
        const codeMatch = jsonContent.match(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/);
        if (codeMatch) {
          jsonContent = codeMatch[1].trim();
        }
      }

      const jsonArrayMatch = jsonContent.match(/\[[\s\S]*?\]/);
      if (jsonArrayMatch) {
        jsonContent = jsonArrayMatch[0];
      }

      const words = JSON.parse(jsonContent);

      if (!Array.isArray(words)) {
        throw new Error(`Expected array, got: ${typeof words}`);
      }

      if (words.length !== 25) {
        throw new Error(`Expected 25 words, got: ${words.length}`);
      }

      return words.map(word => word.toString().trim().toUpperCase());

    } catch (error) {
      if (error.code === 'ETIMEDOUT') {
        throw new Error('Timeout waiting for Claude Code response');
      } else if (error instanceof SyntaxError) {
        throw new Error('JSON parse error from Claude response');
      } else {
        throw new Error(`Word generation error: ${error.message}`);
      }
    }
  }
}

module.exports = ClaudeCodeService;
