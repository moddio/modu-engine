/**
 * Wraps THREE.TransformControls for the region tool. The gizmo binds to a
 * region's fill mesh (a flat plane on the floor); translate moves the mesh
 * center, scale grows/shrinks from the center on the X/Z axes. World tile
 * units throughout — mesh.position is the rect *center* (RegionLayer lays
 * meshes out as centered at `x + w/2, FLOOR_Y, y + h/2` with scale 1), so
 * the rect derivation in `_emitRect` mirrors that layout exactly.
 *
 * 2D restriction (top-down Map tab): only X and Z axes are shown. Rotation
 * is not exposed — regions are axis-aligned (legacy `block-rotation`).
 *
 * Pure THREE; no editor knowledge. Hooks bubble drag start/end to GameRenderer
 * so it can disable the camera controls during drag and forward the new rect
 * to the bridge → `inGameEditor.updateRegionInReact`.
 */

export interface RegionGizmoHooks {
  onDragStart?: () => void;
  onDragEnd?: (id: string, rect: { x: number; y: number; width: number; height: number }) => void;
}

export type GizmoMode = 'translate' | 'scale';

export class RegionGizmo {
  private _control: any;
  private _attachedId: string | null = null;
  private _mode: GizmoMode = 'translate';

  constructor(
    TransformControls: any,
    camera: any,
    domElement: HTMLElement,
    scene: any,
    private _hooks: RegionGizmoHooks = {},
  ) {
    this._control = new TransformControls(camera, domElement);
    this._control.setSize(0.7);
    this._applyAxes();
    this._control.addEventListener('dragging-changed', (e: any) => {
      if (e.value) {
        this._hooks.onDragStart?.();
      } else {
        this._emitRect();
      }
    });
    scene.add(this._control);
  }

  /** The TransformControls helper itself — exposed so callers can read
   *  `.dragging` if they need to gate other pointer logic. */
  get control(): any { return this._control; }

  attach(mesh: any, id: string): void {
    this._attachedId = id;
    this._control.attach(mesh);
    this._applyAxes();
  }

  detach(): void {
    this._attachedId = null;
    this._control.detach();
  }

  setMode(mode: GizmoMode): void {
    this._mode = mode;
    this._control.setMode(mode);
    this._applyAxes();
  }

  dispose(): void {
    this._control.detach();
    this._control.removeFromParent?.();
    this._control.dispose?.();
  }

  /** Restrict the gizmo to the XZ plane (matches legacy `EntityGizmo.updateForDimension`
   *  `dimension === '2d'`: translate/scale show X+Z, rotate would show Y only — but
   *  we never enter rotate mode for regions). */
  private _applyAxes(): void {
    this._control.showX = true;
    this._control.showY = false;
    this._control.showZ = true;
  }

  private _emitRect(): void {
    const mesh = this._control.object;
    if (!mesh || !this._attachedId || !this._hooks.onDragEnd) return;
    // Mesh layout (see RegionLayer._rebuildGeometry):
    //   geometry = PlaneGeometry(width, height) rotated -PI/2 on X (flat on XZ)
    //   position = (x + w/2, FLOOR_Y, y + h/2), scale 1
    // After translate: position carries the new center.
    // After scale:    geometry stays the same; scale.x scales width along X,
    //                 and because the plane is rotated -PI/2 on X, the
    //                 geometry's Y axis (height) maps to world Z — so scale.y
    //                 (NOT scale.z) is the Z-axis scale factor in world space.
    const geom = mesh.geometry;
    const baseW = geom?.parameters?.width ?? 1;
    const baseH = geom?.parameters?.height ?? 1;
    const w = baseW * mesh.scale.x;
    const h = baseH * mesh.scale.y;
    const cx = mesh.position.x;
    const cz = mesh.position.z;
    this._hooks.onDragEnd(this._attachedId, {
      x: cx - w / 2,
      y: cz - h / 2,
      width: w,
      height: h,
    });
  }
}
