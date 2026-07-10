import { describe, expect, it } from 'vitest';
import { isMeaningfulRequirement } from './input-validation';

describe('isMeaningfulRequirement', () => {
  describe('отбрасывает мусор', () => {
    const garbage = [
      ['', 'пустая строка'],
      [' ', 'только пробел'],
      ['  ', 'несколько пробелов'],
      ['\t\n', 'таб/перевод строки'],
      ['ab', 'меньше 3 символов'],
      ['a', 'одиночный символ'],
      ['asdfghjkl', 'keyboard-mash: серия согласных ghjkl'],
      ['bbbb', 'повтор одного символа 4+'],
      ['aaaa', 'повтор одной буквы'],
      ['......', 'повтор пунктуации 6+'],
      ['cvbnm', '5 согласных подряд без гласной'],
      ['asdfg', '5 согласных подряд (с учётом y как гласной нет)'],
    ] as const;

    for (const [input, label] of garbage) {
      it(`rejects ${JSON.stringify(input)} (${label})`, () => {
        expect(isMeaningfulRequirement(input)).toBe(false);
      });
    }
  });

  describe('пропускает осмысленные запросы', () => {
    const valid = [
      'Добавить тёмную тему',
      'Сделать что-то с производительностью', // размыто, но осмысленно
      'Добавить интеграцию с внешним сервисом',
      'Add login', // короткое, но с гласной и пробелом
      'auth', // 4 буквы, гласные есть
      'OAuth 2.0 flow',
      'fix bug', // осмысленное короткое
      'API', // акроним, гласных нет, но длина 3 без длинных серий
      'api',
    ];

    for (const input of valid) {
      it(`accepts ${JSON.stringify(input)}`, () => {
        expect(isMeaningfulRequirement(input)).toBe(true);
      });
    }
  });

  describe('граничные случаи', () => {
    // qwerty: e и y — гласные в нашем наборе, поэтому серии согласных короткие
    // и эвристика его пропускает. Это допустимо: лучше пропустить сомнительный
    // ввод к LLM, чем ложно отбросить легитимное требование.
    it('пропускает "qwerty" (недостаточно признаков mash для отсечения)', () => {
      expect(isMeaningfulRequirement('qwerty')).toBe(true);
    });
  });
});
