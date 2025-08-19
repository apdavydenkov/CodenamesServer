/**
 * Утилита для генерации ИИ-ключей в бэкенде
 */

const CONSONANTS = [
  "Б", "В", "Г", "Д", "З", "К", "Л", "М", "Н", "П", "Р", "С", "Т", "Х"
];
const VOWELS = ["А", "И", "О", "У", "Е", "Я"];

/**
 * Генерация нового ИИ-ключа
 * @returns {string} - новый ключ формата СГСГСГН
 */
function generateAIKey() {
  const key = [];
  
  // Генерируем СГСГСГ паттерн
  for (let i = 0; i < 6; i++) {
    const isVowel = i % 2 === 1;
    const letters = isVowel ? VOWELS : CONSONANTS;
    key.push(letters[Math.floor(Math.random() * letters.length)]);
  }
  
  // Добавляем букву ИИ-словаря
  key.push('Н');
  
  return key.join('');
}

/**
 * Проверка является ли ключ ИИ-ключом
 * @param {string} key - ключ для проверки
 * @returns {boolean}
 */
function isAIKey(key) {
  return key && key.length === 7 && key[6] === 'Н';
}

module.exports = {
  generateAIKey,
  isAIKey
};