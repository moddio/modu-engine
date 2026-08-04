import { describe, it, expect } from 'vitest';
import {
  cameraDistance,
  taroVisibleHeight,
  visibleWorldSpan,
  tilePxOf,
  gameDataZoomOf,
  CAMERA_DISTANCE_MULTIPLIER,
} from '../../../engine/client/renderer/cameraFraming';

/**
 * These functions decide how far the camera sits from its target. Both bugs they
 * encode presented identically and silently: the game booted, the HUD was live, the
 * scene was fully populated, nothing threw — and the viewport was a flat grey
 * rectangle, because the camera was tens of times too far away for any of it to cover
 * a pixel. Neither is catchable by a typechecker or a smoke test, hence these.
 */

const VW = 1280;
const VH = 800;
const map = (tilewidth: number) => ({ width: 57, height: 57, tilewidth, tileheight: tilewidth });
const ortho = (zoom: unknown) => ({ projectionMode: 'orthographic', zoom });
const persp = (zoom: unknown, fov = 75) => ({ projectionMode: 'perspective', fov, zoom });

describe('cameraFraming / inputs', () => {
  it('reads the tile size from the map instead of assuming 64', () => {
    // Hardcoding 64 while the map declares 16 put the camera 4× too far out. The
    // renderer converts taro pixels to world units with px / map.tilewidth throughout,
    // so the scale is whatever the map says.
    expect(tilePxOf(map(16))).toBe(16);
    expect(tilePxOf(map(32))).toBe(32);
    expect(tilePxOf(undefined)).toBe(64); // only the fallback is 64
  });

  it('accepts the zoom as a number, an object, or a numeric string', () => {
    // Braains3D stores settings.camera.zoom.default as the STRING "12.5". A
    // typeof === 'number' check skipped it and the camera ended up 16× too far.
    expect(gameDataZoomOf({ zoom: 200 })).toBe(200);
    expect(gameDataZoomOf({ zoom: { default: 200 } })).toBe(200);
    expect(gameDataZoomOf({ zoom: '200' })).toBe(200);
    expect(gameDataZoomOf({ zoom: { default: '200' } })).toBe(200);
  });

  it('falls back to taro default zoom when there is none', () => {
    expect(gameDataZoomOf(undefined)).toBe(1000);
    expect(gameDataZoomOf({})).toBe(1000);
  });

  it('shrinks the visible height on mobile the way taro does', () => {
    const desktop = taroVisibleHeight(map(16), ortho(200), VW, VH, false);
    const mobile = taroVisibleHeight(map(16), ortho(200), VW, VH, true);
    expect(mobile).toBeCloseTo(desktop * 0.75, 6);
  });

  it('scales the visible height inversely with tile size', () => {
    const at16 = taroVisibleHeight(map(16), ortho(200), VW, VH);
    const at32 = taroVisibleHeight(map(32), ortho(200), VW, VH);
    expect(at16).toBeCloseTo(at32 * 2, 6);
  });
});

describe('cameraFraming / the camera reproduces the requested zoom', () => {
  /**
   * The load-bearing property, and the one worth asserting: whatever distance is
   * chosen, the span the engine's own projection math yields at that distance must
   * equal the span taro asked for. `visibleWorldSpan` deliberately recomputes from the
   * projection rather than calling `taroVisibleHeight`, so this is not circular.
   */
  for (const [label, cam] of [
    ['orthographic', ortho(200)],
    ['perspective 75°', persp(200, 75)],
    ['perspective 50°', persp(200, 50)],
  ] as const) {
    it(`round-trips in ${label}`, () => {
      const want = taroVisibleHeight(map(16), cam, VW, VH);
      const d = cameraDistance(map(16), cam, VW, VH);
      expect(visibleWorldSpan(d, cam, VH)).toBeCloseTo(want, 9);
    });
  }

  it('round-trips across tile sizes and viewports', () => {
    for (const tile of [8, 16, 32, 64]) {
      for (const [w, h] of [[1280, 800], [390, 844], [2560, 1440]]) {
        for (const cam of [ortho(200), persp(200)]) {
          const want = taroVisibleHeight(map(tile), cam, w, h);
          const d = cameraDistance(map(tile), cam, w, h);
          expect(visibleWorldSpan(d, cam, h)).toBeCloseTo(want, 9);
        }
      }
    }
  });
});

describe('cameraFraming / projection modes are not interchangeable', () => {
  it('does not use the orthographic distance for a perspective camera', () => {
    // This was the bug. The ortho formula applied to Braains3D's perspective camera
    // gave distance 47.6 and showed 104 tiles of a 57-tile map instead of taro's 16.8.
    const cam = persp(200);
    const orthoDistance = VH / taroVisibleHeight(map(16), cam, VW, VH);
    const actual = cameraDistance(map(16), cam, VW, VH);
    expect(actual).not.toBeCloseTo(orthoDistance, 1);

    // And the ortho distance really would have overshot badly in perspective.
    const wrongSpan = visibleWorldSpan(orthoDistance, cam, VH);
    const want = taroVisibleHeight(map(16), cam, VW, VH);
    expect(wrongSpan).toBeGreaterThan(want * 4);
  });

  it('places a perspective eye at distance × the engine multiplier', () => {
    // CameraController._updatePosition puts the eye at `distance * 3`; the framing math
    // has to agree with it or the span is off by that factor.
    const cam = persp(200, 75);
    const d = cameraDistance(map(16), cam, VW, VH);
    const halfAngle = Math.tan((75 * Math.PI) / 360);
    expect(visibleWorldSpan(d, cam, VH))
      .toBeCloseTo(2 * CAMERA_DISTANCE_MULTIPLIER * d * halfAngle, 9);
  });

  it('treats a camera with no projectionMode as orthographic', () => {
    const implicit = { zoom: 200 };
    expect(cameraDistance(map(16), implicit, VW, VH))
      .toBeCloseTo(cameraDistance(map(16), ortho(200), VW, VH), 9);
  });

  it('matches the legacy 64px orthographic formula, so 2D games are unaffected', () => {
    // Web computed `distance = 64 * max(w, h) / (zoom * 2.15)` inline. For an
    // orthographic camera on a 64px map that is exactly what this returns — the shared
    // version only diverges where the old one was wrong (other tile sizes, perspective).
    const zoom = 200;
    const legacy = (64 * Math.max(VW, VH)) / (zoom * 2.15);
    expect(cameraDistance(map(64), ortho(zoom), VW, VH)).toBeCloseTo(legacy, 9);
  });

  it('moves the span in OPPOSITE directions per mode as distance grows', () => {
    // A trap worth pinning down, because "distance" does not mean the same thing in
    // both modes. Perspective is the physical reading: further away sees more. In
    // orthographic the engine derives the frustum as `±viewportHeight / (2 * distance)`,
    // so `distance` acts as an inverse zoom factor and a bigger value sees LESS.
    // Assuming the perspective reading for both is how the ortho formula came to be
    // applied to a perspective camera in the first place.
    expect(visibleWorldSpan(50, persp(200), VH)).toBeGreaterThan(visibleWorldSpan(5, persp(200), VH));
    expect(visibleWorldSpan(50, ortho(200), VH)).toBeLessThan(visibleWorldSpan(5, ortho(200), VH));
  });

  it('asks for a bigger zoom number by framing more world, in both modes', () => {
    // The invariant that *is* shared: whatever the mode, a larger authored zoom must
    // end up showing more of the map.
    for (const mk of [ortho, (z: number) => persp(z)]) {
      const small = mk(100);
      const large = mk(400);
      const spanSmall = visibleWorldSpan(cameraDistance(map(16), small, VW, VH), small, VH);
      const spanLarge = visibleWorldSpan(cameraDistance(map(16), large, VW, VH), large, VH);
      expect(spanLarge).toBeGreaterThan(spanSmall);
    }
  });
});
