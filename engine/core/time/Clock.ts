interface TimerEntry { name: string; delay: number; elapsed: number; callback: () => void; repeat: boolean; }

export class Clock {
  tickRate: number;
  elapsed = 0;
  dt = 0;
  tick = 0;
  private _timers = new Map<string, TimerEntry>();

  constructor(tickRate: number = 60) { this.tickRate = tickRate; }

  get targetDt(): number { return 1000 / this.tickRate; }

  step(dtMs: number): void {
    this.dt = dtMs;
    this.elapsed += dtMs;
    this.tick++;
    this._updateTimers(dtMs);
  }

  addTimer(name: string, delayMs: number, callback: () => void): void {
    this._timers.set(name, { name, delay: delayMs, elapsed: 0, callback, repeat: false });
  }

  removeTimer(name: string): void { this._timers.delete(name); }

  addInterval(name: string, intervalMs: number, callback: () => void): void {
    this._timers.set(name, { name, delay: intervalMs, elapsed: 0, callback, repeat: true });
  }

  removeInterval(name: string): void { this._timers.delete(name); }

  private _updateTimers(dtMs: number): void {
    const toRemove: string[] = [];
    for (const [name, timer] of this._timers) {
      timer.elapsed += dtMs;
      if (timer.elapsed >= timer.delay) {
        timer.callback();
        if (timer.repeat) timer.elapsed -= timer.delay;
        else toRemove.push(name);
      }
    }
    for (const name of toRemove) this._timers.delete(name);
  }
}
