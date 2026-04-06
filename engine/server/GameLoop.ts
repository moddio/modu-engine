export class GameLoop {
  private _interval: ReturnType<typeof setInterval> | null = null;
  private _tickRate: number;
  private _lastTime = 0;
  private _onTick: (dt: number) => void;

  constructor(tickRate: number, onTick: (dt: number) => void) {
    this._tickRate = tickRate;
    this._onTick = onTick;
  }

  get tickRate(): number { return this._tickRate; }
  set tickRate(rate: number) { this._tickRate = rate; }
  get isRunning(): boolean { return this._interval !== null; }

  start(): void {
    if (this._interval) return;
    this._lastTime = Date.now();
    this._interval = setInterval(() => {
      const now = Date.now();
      const dt = now - this._lastTime;
      this._lastTime = now;
      this._onTick(dt);
    }, 1000 / this._tickRate);
  }

  stop(): void {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}
