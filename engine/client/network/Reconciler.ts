// engine/client/network/Reconciler.ts
import type { PredictedState } from './Predictor';

export interface ServerState {
  tick: number;
  x: number;
  y: number;
  angle: number;
}

export interface ReconcileResult {
  corrected: boolean;
  errorX: number;
  errorY: number;
  correctedX: number;
  correctedY: number;
}

export class Reconciler {
  private _threshold: number;
  private _smoothing: number;

  constructor(threshold: number = 0.1, smoothing: number = 0.3) {
    this._threshold = threshold;
    this._smoothing = smoothing;
  }

  reconcile(
    serverState: ServerState,
    predictedState: PredictedState | undefined,
    currentX: number,
    currentY: number,
  ): ReconcileResult {
    if (!predictedState) {
      return {
        corrected: true,
        errorX: serverState.x - currentX,
        errorY: serverState.y - currentY,
        correctedX: serverState.x,
        correctedY: serverState.y,
      };
    }

    const errorX = serverState.x - predictedState.x;
    const errorY = serverState.y - predictedState.y;
    const errorMag = Math.sqrt(errorX * errorX + errorY * errorY);

    if (errorMag < this._threshold) {
      return { corrected: false, errorX: 0, errorY: 0, correctedX: currentX, correctedY: currentY };
    }

    // Smooth correction
    const correctedX = currentX + errorX * this._smoothing;
    const correctedY = currentY + errorY * this._smoothing;

    return { corrected: true, errorX, errorY, correctedX, correctedY };
  }
}
