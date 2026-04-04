import { describe, it, expect } from 'vitest';
import { VERSION } from 'modu-engine';

describe('Project Setup', () => {
  it('should export VERSION 0.1.0', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
