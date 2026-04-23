import * as THREE from 'three';
import type { VoxelTileMap } from './VoxelTileMap';

export type MarkerMode = 'brush' | 'eraser' | 'none';

/**
 * Translucent cursor shown at the current tile under the pointer.
 * - `eraser` mode: solid red translucent box over the brush footprint.
 * - `brush` mode: delegates to `VoxelTileMap.renderPreview` to draw a ghost of the tile(s) about to be placed.
 */
export class VoxelMarker {
  readonly group = new THREE.Group();
  private _voxelTileMap: VoxelTileMap;
  private _eraserMesh: THREE.Mesh | null = null;
  private _lastTile: { x: number; y: number } | null = null;

  constructor(voxelTileMap: VoxelTileMap) {
    this._voxelTileMap = voxelTileMap;
    this.group.name = 'voxelMarker';
    voxelTileMap.group.add(this.group);
  }

  /**
   * Show marker for `mode` at tile (tileX, tileY) on `layer` with brush footprint (bw, bh)
   * and (if brush mode) tile gid to preview.
   */
  showAt(
    mode: MarkerMode,
    tileX: number,
    tileY: number,
    layer: number,
    bw: number,
    bh: number,
    gid: number,
  ): void {
    // Skip if nothing changed — avoids per-frame rebuild.
    const changed = !this._lastTile || this._lastTile.x !== tileX || this._lastTile.y !== tileY;
    this._lastTile = { x: tileX, y: tileY };

    this.clear();
    if (mode === 'none') return;

    if (mode === 'eraser') {
      const y = this._voxelTileMap.calcLayerCenterY(layer);
      const geo = new THREE.BoxGeometry(bw + 0.02, 1.02, bh + 0.02);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.4, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(tileX + bw / 2, y, tileY + bh / 2);
      mesh.renderOrder = 999;
      this.group.add(mesh);
      this._eraserMesh = mesh;
      return;
    }

    // Brush preview: build sample for the brush footprint, render via preview chunk.
    if (!changed && this._voxelTileMap.loaded) {
      // Re-render on every move for tile id changes even if pos is same.
    }
    const tiles: Record<number, Record<number, number>> = {};
    for (let sx = 0; sx < bw; sx++) {
      const col: Record<number, number> = {};
      for (let sy = 0; sy < bh; sy++) {
        col[tileY + sy] = gid;
      }
      tiles[tileX + sx] = col;
    }
    this._voxelTileMap.renderPreview(layer, tiles, true);
  }

  clear(): void {
    if (this._eraserMesh) {
      this._eraserMesh.geometry.dispose();
      (this._eraserMesh.material as THREE.Material).dispose();
      this._eraserMesh.removeFromParent();
      this._eraserMesh = null;
    }
    // Remove any remaining children (defensive).
    while (this.group.children.length > 0) {
      const c = this.group.children[0];
      const mesh = c as THREE.Mesh;
      mesh.geometry?.dispose?.();
      (mesh.material as THREE.Material | undefined)?.dispose?.();
      this.group.remove(c);
    }
    this._voxelTileMap.clearPreview();
    this._lastTile = null;
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }
}
