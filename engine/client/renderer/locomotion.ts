/**
 * Derives "is this unit walking?" from the authoritative server transforms.
 *
 * The engine has no locomotion animation state — `_streamTransforms` sends
 * `{x, z, rotation}` and nothing else — so the renderer infers idle↔run from
 * how far a unit's target has travelled. The subtlety is the sample rate: a
 * target only changes when a snapshot arrives, but the render loop asks every
 * frame, so some frames have no new displacement to measure. Taking the delta
 * between consecutive *frames* therefore reads speed 0 on those frames, drops
 * the unit to idle, and the next snapshot restarts the run clip from frame 0 —
 * the animation visibly resets while the player holds a single direction.
 *
 * That happens at any broadcast rate, because snapshot arrivals are never
 * phase-locked to rAF: at 20Hz two frames in three measure nothing (~79 clip
 * restarts in 2s of straight-line walking), and even at the ~60Hz this export
 * broadcasts, drift and delivery jitter still strand ~8-15 frames per 2s.
 *
 * The fix is to measure over a window that always spans several server ticks,
 * so every decision is made from real displacement rather than from a gap in
 * the stream. Frames inside the window return `null` — "no opinion, keep
 * playing whatever is playing" — which is what keeps the clip continuous.
 */

/** Speed (tiles/sec) a stationary unit must exceed before its run clip starts. */
export const START_MOVING = 0.6;
/** Speed (tiles/sec) a moving unit must drop below before it returns to idle.
 *  Lower than START_MOVING so a unit hovering at walking pace can't strobe. */
export const STOP_MOVING = 0.25;
/**
 * Measurement window, in seconds. Must comfortably exceed the gap between
 * snapshots (50ms at 20Hz, the slowest rate worth supporting): a window
 * shorter than one gap can observe zero displacement from a unit at full
 * sprint, which is the whole bug. Spanning several snapshots also keeps the
 * ±1 frame of sampling jitter down to ~10% of the measured speed, so units
 * near the thresholds settle instead of oscillating.
 * The cost is that a clip change lags the movement itself by up to this long,
 * which the 0.2s crossfade already smooths over.
 */
export const LOCOMOTION_WINDOW = 0.15;

type Sample = { x: number; z: number; t: number };

/** Per-entity locomotion state derived from server transform targets. */
export class LocomotionTracker {
  private _samples = new Map<string, Sample>();
  private _moving = new Set<string>();

  /** Whether this entity was last judged to be moving. */
  isMoving(entityId: string): boolean {
    return this._moving.has(entityId);
  }

  /**
   * Feed one entity's authoritative target for this frame.
   *
   * @param now seconds, monotonic (the render loop's clock)
   * @returns the entity's movement state when the window closed on this frame,
   *          or `null` when there isn't a full window of evidence yet — callers
   *          must leave the current clip alone on `null`.
   */
  sample(entityId: string, x: number, z: number, now: number): boolean | null {
    const prev = this._samples.get(entityId);
    if (!prev) {
      this._samples.set(entityId, { x, z, t: now });
      return null;
    }

    const elapsed = now - prev.t;
    if (elapsed < LOCOMOTION_WINDOW) return null;

    const speed = Math.hypot(x - prev.x, z - prev.z) / elapsed;
    this._samples.set(entityId, { x, z, t: now });

    // Hysteresis: which threshold applies depends on what we're already doing.
    const isMoving = this._moving.has(entityId) ? speed > STOP_MOVING : speed > START_MOVING;
    if (isMoving) this._moving.add(entityId);
    else this._moving.delete(entityId);
    return isMoving;
  }

  /** Drop an entity's state (on destroy) so ids can't leak or be reused stale. */
  forget(entityId: string): void {
    this._samples.delete(entityId);
    this._moving.delete(entityId);
  }
}
