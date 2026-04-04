export type ValidationResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface InputData {
  keys: number[];
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
  angle: number;
}

export class InputValidator {
  static validateInput(payload: unknown): ValidationResult<InputData> {
    if (!payload || typeof payload !== 'object') {
      return { ok: false, error: 'Invalid payload' };
    }

    const p = payload as Record<string, unknown>;

    if (!Array.isArray(p.keys)) return { ok: false, error: 'keys must be array' };
    if (typeof p.mouseX !== 'number' || !isFinite(p.mouseX)) return { ok: false, error: 'invalid mouseX' };
    if (typeof p.mouseY !== 'number' || !isFinite(p.mouseY)) return { ok: false, error: 'invalid mouseY' };
    if (typeof p.mouseDown !== 'boolean') return { ok: false, error: 'invalid mouseDown' };
    if (typeof p.angle !== 'number' || !isFinite(p.angle)) return { ok: false, error: 'invalid angle' };

    // Validate key codes are reasonable numbers
    for (const key of p.keys) {
      if (typeof key !== 'number' || key < 0 || key > 255) {
        return { ok: false, error: 'invalid key code' };
      }
    }

    return {
      ok: true,
      data: {
        keys: p.keys as number[],
        mouseX: p.mouseX as number,
        mouseY: p.mouseY as number,
        mouseDown: p.mouseDown as boolean,
        angle: p.angle as number,
      },
    };
  }

  static sanitizeString(input: string, maxLength: number = 200): string {
    if (typeof input !== 'string') return '';
    return input.slice(0, maxLength).replace(/[<>&"']/g, '');
  }
}
