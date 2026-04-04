export interface RateLimitRule {
  maxPerSecond: number;
}

export class RateLimiter {
  private _rules = new Map<string, RateLimitRule>();
  private _counters = new Map<string, { count: number; resetAt: number }>();

  setRule(action: string, rule: RateLimitRule): void {
    this._rules.set(action, rule);
  }

  check(playerId: string, action: string): boolean {
    const rule = this._rules.get(action);
    if (!rule) return true; // No rule = allow

    const key = `${playerId}:${action}`;
    const now = Date.now();
    let counter = this._counters.get(key);

    if (!counter || now >= counter.resetAt) {
      counter = { count: 0, resetAt: now + 1000 };
      this._counters.set(key, counter);
    }

    counter.count++;
    return counter.count <= rule.maxPerSecond;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, counter] of this._counters) {
      if (now >= counter.resetAt) this._counters.delete(key);
    }
  }
}
