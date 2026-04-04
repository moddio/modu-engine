import { describe, it, expect } from 'vitest';
import { InputValidator } from '../../../engine/server/network/InputValidator';

describe('InputValidator', () => {
  describe('validateInput', () => {
    it('accepts valid input', () => {
      const result = InputValidator.validateInput({
        keys: [87, 68], mouseX: 100, mouseY: 200, mouseDown: false, angle: 1.5,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.keys).toEqual([87, 68]);
    });

    it('rejects null', () => { expect(InputValidator.validateInput(null).ok).toBe(false); });
    it('rejects non-object', () => { expect(InputValidator.validateInput('hi').ok).toBe(false); });
    it('rejects missing keys', () => {
      expect(InputValidator.validateInput({ mouseX: 0, mouseY: 0, mouseDown: false, angle: 0 }).ok).toBe(false);
    });
    it('rejects NaN mouseX', () => {
      expect(InputValidator.validateInput({ keys: [], mouseX: NaN, mouseY: 0, mouseDown: false, angle: 0 }).ok).toBe(false);
    });
    it('rejects Infinity', () => {
      expect(InputValidator.validateInput({ keys: [], mouseX: Infinity, mouseY: 0, mouseDown: false, angle: 0 }).ok).toBe(false);
    });
    it('rejects invalid key codes', () => {
      expect(InputValidator.validateInput({ keys: [999], mouseX: 0, mouseY: 0, mouseDown: false, angle: 0 }).ok).toBe(false);
    });
  });

  describe('sanitizeString', () => {
    it('removes HTML chars', () => {
      expect(InputValidator.sanitizeString('<script>alert("xss")</script>')).toBe('scriptalert(xss)/script');
    });
    it('truncates to maxLength', () => {
      expect(InputValidator.sanitizeString('a'.repeat(300), 10)).toBe('a'.repeat(10));
    });
    it('handles non-string', () => {
      expect(InputValidator.sanitizeString(42 as any)).toBe('');
    });
  });
});
