import { describe, it, expect } from 'vitest';
import { add } from './math.js';

describe('math utils', () => {
  describe('add', () => {
    it('should add two positive numbers', () => {
      expect(add(2, 3)).toBe(5);
    });

    it('should handle negative numbers', () => {
      expect(add(-2, 3)).toBe(1);
    });

    it('should handle zero', () => {
      expect(add(0, 5)).toBe(5);
    });
  });
});
