/**
 * Программная проверка осмысленности пользовательского запроса к архитектору.
 *
 * Используется как guardrail ДО вызова LLM: откровенно мусорный ввод
 * (пустые сообщения, keyboard-mash, одиночные символы) отсекается без
 * расхода токенов и времени на structured output, который всё равно не
 * сформируется для таких входов.
 *
 * Консервативные эвристики — лучше пропустить сомнительный, но короткий
 * запрос к LLM, чем ложно отбросить легитимное требование.
 *
 * Замечание: эта проверка не пытается оценить семантическую размытость
 * («добавить интеграцию» — размыто, но осмысленно). Она ловит только
 * заведомо неадекватный ввод.
 */

/** Гласные латиницы и кириллицы (y/й считаются гласными для устойчивости). */
const VOWELS = new Set('aeiouyаеёиоуыэюя');
const LETTER_RE = /[a-zа-яё]/i;

/**
 * Максимальное число согласных подряд без единой гласной между ними.
 * Длинные серии согласных — устойчивый признак keyboard-mash
 * (например "asdfghjkl" → 8 согласных подряд после 'a').
 */
function maxConsecutiveConsonants(text: string): number {
  let max = 0;
  let current = 0;
  for (const ch of text.toLowerCase()) {
    if (LETTER_RE.test(ch) && !VOWELS.has(ch)) {
      current++;
      if (current > max) {
        max = current;
      }
    } else {
      current = 0;
    }
  }
  return max;
}

/**
 * True, если `text` содержит 4+ одинаковых символа подряд без перерыва
 * (например "aaaa", ".....", "    ").
 */
function hasLongRunOfSameChar(text: string): boolean {
  let run = 1;
  for (let i = 1; i < text.length; i++) {
    if (text[i] === text[i - 1]) {
      run++;
      if (run >= 4) {
        return true;
      }
    } else {
      run = 1;
    }
  }
  return false;
}

/**
 * Является ли запрос осмысленным требованием, которое стоит передавать LLM.
 *
 * Возвращает false (мусор) при:
 *  - пустом или только из пробелов вводе;
 *  - длине < 3 после trim;
 *  - повторе одного символа 4+ раза подряд;
 *  - 4+ согласных подряд без гласной (keyboard-mash).
 *
 * Возвращает true для всего остального — размытые, но осмысленные запросы
 * уходят к агенту как есть.
 */
export function isMeaningfulRequirement(text: string): boolean {
  const trimmed = text.trim();

  if (trimmed.length < 3) {
    return false;
  }

  if (hasLongRunOfSameChar(trimmed)) {
    return false;
  }

  if (trimmed.length >= 4 && maxConsecutiveConsonants(trimmed) >= 4) {
    return false;
  }

  return true;
}
