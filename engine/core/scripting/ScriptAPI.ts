import { EventEmitter } from '../events/EventEmitter';

export type ScriptHandler = (...args: unknown[]) => void;

export class ScriptAPI {
  private _events: EventEmitter;
  private _intervals: Array<{ intervalMs: number; callback: () => void; elapsed: number }> = [];

  constructor(events: EventEmitter) {
    this._events = events;
  }

  on(event: string, handler: ScriptHandler): void {
    this._events.on(event, handler);
  }

  every(intervalMs: number, callback: () => void): void {
    this._intervals.push({ intervalMs, callback, elapsed: 0 });
  }

  update(dt: number): void {
    for (const interval of this._intervals) {
      interval.elapsed += dt;
      if (interval.elapsed >= interval.intervalMs) {
        interval.callback();
        interval.elapsed -= interval.intervalMs;
      }
    }
  }

  reset(): void {
    this._intervals = [];
  }
}
