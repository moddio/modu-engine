export class DeltaCompressor {
  static diff(prev: Record<string, unknown>, curr: Record<string, unknown>): Record<string, unknown> | null {
    const delta: Record<string, unknown> = {};
    let hasChanges = false;

    for (const key of Object.keys(curr)) {
      if (prev[key] !== curr[key]) {
        delta[key] = curr[key];
        hasChanges = true;
      }
    }

    // Check for removed keys
    for (const key of Object.keys(prev)) {
      if (!(key in curr)) {
        delta[key] = undefined;
        hasChanges = true;
      }
    }

    return hasChanges ? delta : null;
  }

  static apply(base: Record<string, unknown>, delta: Record<string, unknown>): Record<string, unknown> {
    const result = { ...base };
    for (const [key, value] of Object.entries(delta)) {
      if (value === undefined) {
        delete result[key];
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
