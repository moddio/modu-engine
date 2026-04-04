// engine/client/network/Predictor.ts
import { Vec2 } from '../../core/math/Vec2';

export interface PredictedState {
  tick: number;
  x: number;
  y: number;
  angle: number;
}

export interface PredictionInput {
  tick: number;
  moveX: number; // -1 to 1
  moveY: number; // -1 to 1
  angle: number;
  speed: number;
}

export class Predictor {
  private _history: PredictedState[] = [];
  private _maxHistory: number;

  constructor(maxHistory: number = 120) {
    this._maxHistory = maxHistory;
  }

  predict(input: PredictionInput, dt: number): PredictedState {
    const last = this._history.length > 0 ? this._history[this._history.length - 1] : { tick: 0, x: 0, y: 0, angle: 0 };

    const state: PredictedState = {
      tick: input.tick,
      x: last.x + input.moveX * input.speed * (dt / 1000),
      y: last.y + input.moveY * input.speed * (dt / 1000),
      angle: input.angle,
    };

    this._history.push(state);
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }

    return state;
  }

  getState(tick: number): PredictedState | undefined {
    return this._history.find(s => s.tick === tick);
  }

  get latestState(): PredictedState | undefined {
    return this._history[this._history.length - 1];
  }

  get historySize(): number { return this._history.length; }

  clearBefore(tick: number): void {
    this._history = this._history.filter(s => s.tick >= tick);
  }

  reset(): void { this._history = []; }
}
