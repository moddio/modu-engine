/**
 * Camera framing — how far the camera sits from its target, derived from the
 * export's own `settings.camera.zoom`.
 *
 * Shared deliberately: every `GameClient` uses it to build the camera, and
 * braains3d's `tools/verify.ts` uses it to assert the camera reproduces that zoom.
 * Both call the same functions, so a green verify says something about the real boot
 * path rather than about a reimplementation of it.
 *
 * It lives in the engine because the formulas below are pinned to `CameraController`'s
 * projection math, which is engine-side: change how the controller places the eye and
 * these have to change with it. Web previously carried its own inline copy that had
 * neither the per-map tile size nor the perspective branch.
 *
 * The goal is taro's visible world span (moddio2/src/client.js:507-514 →
 * emit('zoom') → three/Camera.ts:setZoomByHeight):
 *   gameDataZoom = settings.camera.zoom.default ?? 1000
 *   mobile:        gameDataZoom *= 0.75
 *   zoomHeight   = gameDataZoom * 2.15
 *   ortho.zoom   = max(W, H) / zoomHeight       (recomputed on resize)
 * Taro renders with pixelToWorld = px/tilePx, so the world height it shows is
 *   H / (tilePx * ortho.zoom) = H * zoomHeight / (tilePx * max(W, H)).
 *
 * Modu reaches that span differently depending on projection mode, and the two
 * are NOT interchangeable — read from the engine bundle (`CameraController`):
 *   orthographic: top/bottom = ±H / (2 * distance)   → visible height = H / distance
 *   perspective:  position   = target + 3 * distance → visible height =
 *                                                      2 * (3 * distance) * tan(fov/2)
 * Braains3D is `projectionMode: 'perspective'`, and the ortho formula was being
 * applied to it: distance came out 47.6 and the camera showed 104 tiles of a
 * 57-tile map instead of taro's 16.8, which is why everything looked like a
 * distant diorama even once it was on screen at all.
 */

/** Engine constant: `_updatePosition()` places the eye at `distance * 3`. */
export const CAMERA_DISTANCE_MULTIPLIER = 3;

/**
 * Pixels per world unit for a map.
 *
 * NOT a constant 64. `GameRenderer` converts taro pixels to world units with
 * `px / map.tilewidth` throughout (GameRenderer.ts:339, 806, 1167), so the scale
 * is whatever tile size the map declares — Braains3D's is 16.
 */
export function tilePxOf(map: Record<string, any> | undefined): number {
  return Number(map?.tilewidth) || 64;
}

/**
 * The export's camera zoom as a number. Callers get raw-pixel values here only
 * if the data went through `denormalize3DGameData` first — 3D exports store zoom
 * pre-divided by the tile size, sometimes as a string.
 */
export function gameDataZoomOf(camera: Record<string, any> | undefined): number {
  const z = camera?.zoom;
  return Number((typeof z === 'object' && z !== null ? z.default : z) ?? 1000) || 1000;
}

/** The world height, in tiles, that taro would show for this zoom and viewport. */
export function taroVisibleHeight(
  map: Record<string, any> | undefined,
  camera: Record<string, any> | undefined,
  viewportWidth: number,
  viewportHeight: number,
  isMobile = false,
): number {
  const gameDataZoom = gameDataZoomOf(camera);
  const emittedZoom = isMobile ? gameDataZoom * 0.75 : gameDataZoom;
  const zoomHeight = emittedZoom * 2.15;
  return (viewportHeight * zoomHeight) / (tilePxOf(map) * Math.max(viewportWidth, viewportHeight));
}

function isPerspective(camera: Record<string, any> | undefined): boolean {
  return (camera?.projectionMode ?? 'orthographic') === 'perspective';
}

/** Distance from the camera to its target, in world units. */
export function cameraDistance(
  map: Record<string, any> | undefined,
  camera: Record<string, any> | undefined,
  viewportWidth: number,
  viewportHeight: number,
  isMobile = false,
): number {
  const wantHeight = taroVisibleHeight(map, camera, viewportWidth, viewportHeight, isMobile);
  if (isPerspective(camera)) {
    const fov = Number(camera?.fov) || 75;
    return wantHeight / (2 * CAMERA_DISTANCE_MULTIPLIER * Math.tan((fov * Math.PI) / 360));
  }
  // Orthographic: the engine derives the frustum straight from `distance`.
  return viewportHeight / wantHeight;
}

/**
 * The world height, in tiles, the camera actually shows at `distance` — computed
 * from the engine's own projection math, deliberately NOT from `taroVisibleHeight`.
 * Comparing the two is what makes the verify check meaningful rather than circular.
 */
export function visibleWorldSpan(
  distance: number,
  camera: Record<string, any> | undefined,
  viewportHeight: number,
): number {
  if (isPerspective(camera)) {
    const fov = Number(camera?.fov) || 75;
    return 2 * CAMERA_DISTANCE_MULTIPLIER * distance * Math.tan((fov * Math.PI) / 360);
  }
  return viewportHeight / distance;
}
