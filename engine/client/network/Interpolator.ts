// engine/client/network/Interpolator.ts
export interface InterpolationTarget {
  prevX: number;
  prevY: number;
  prevAngle: number;
  nextX: number;
  nextY: number;
  nextAngle: number;
  prevTick: number;
  nextTick: number;
}

export interface InterpolatedState {
  x: number;
  y: number;
  angle: number;
}

export class Interpolator {
  static interpolate(target: InterpolationTarget, currentTick: number): InterpolatedState {
    const range = target.nextTick - target.prevTick;
    if (range <= 0) {
      return { x: target.nextX, y: target.nextY, angle: target.nextAngle };
    }

    const t = Math.max(0, Math.min(1, (currentTick - target.prevTick) / range));

    return {
      x: target.prevX + (target.nextX - target.prevX) * t,
      y: target.prevY + (target.nextY - target.prevY) * t,
      angle: lerpAngle(target.prevAngle, target.nextAngle, t),
    };
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
