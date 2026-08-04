/**
 * Renders editor regions as translucent colored rectangles + border + name
 * label on the floor plane. Pure world tile units; THREE injected for tests.
 * Y plane: entities sit at y=-0.501; regions at y=-0.5 (just above tiles,
 * below entities). PlaneGeometry is rotated flat onto the XZ ground.
 */
const FLOOR_Y = -0.5;
// The region's `alpha`/`inside` are GAMEPLAY properties. The Map-tab preview
// must always be a faint tint + prominent border (matches the legacy engine
// RegionRenderer's hardcoded 0.2) so full-map / overlapping regions don't paint
// an opaque sheet over the map. Gameplay alpha is preserved on the record for
// the edit modal round-trip but does NOT drive the preview fill.
const REGION_FILL_OPACITY = 0.18;
const REGION_BORDER_OPACITY = 0.9;
// Selection highlight: brighter fill + slight overlay so the selected region
// reads clearly even before the TransformControls gizmo paints over it.
const REGION_FILL_OPACITY_SELECTED = 0.32;

export interface RegionInit { x: number; y: number; width: number; height: number; color?: string; alpha?: number; }
export interface RegionRecord { id: string; x: number; y: number; width: number; height: number; color: string; alpha: number; }

interface RegionObj extends RegionRecord {
  group: any; fill: any; fillGeom: any; fillMat: any;
  border: any; borderGeom: any; borderMat: any;
  label: any; labelMat: any; labelTex: any; canvas: HTMLCanvasElement | null;
}

export class RegionLayer {
  readonly group: any;
  private _T: any;
  private _regions = new Map<string, RegionObj>();
  private _order: string[] = [];
  private _selectedId: string | null = null;

  constructor(THREE: any) {
    this._T = THREE;
    this.group = new THREE.Group();
    this.group.name = 'regionLayer';
  }

  private _colorNum(c?: string): number {
    if (!c) return 0x00ff00;
    const s = c.trim();
    if (s.startsWith('#')) { const v = parseInt(s.slice(1), 16); return Number.isFinite(v) ? v : 0x00ff00; }
    return 0x00ff00;
  }

  private _rebuildGeometry(o: RegionObj): void {
    const T = this._T;
    o.fillGeom?.dispose?.();
    o.fillGeom = new T.PlaneGeometry(o.width, o.height);
    o.fill.geometry = o.fillGeom;
    o.fill.position.set(o.x + o.width / 2, FLOOR_Y, o.y + o.height / 2);
    o.fill.rotation.set(-Math.PI / 2, 0, 0);
    // border: line loop of the 4 corners on the floor
    o.borderGeom?.dispose?.();
    o.borderGeom = new T.BufferGeometry().setFromPoints([
      new T.Vector3(o.x, FLOOR_Y, o.y),
      new T.Vector3(o.x + o.width, FLOOR_Y, o.y),
      new T.Vector3(o.x + o.width, FLOOR_Y, o.y + o.height),
      new T.Vector3(o.x, FLOOR_Y, o.y + o.height),
    ]);
    o.border.geometry = o.borderGeom;
    o.label.position.set(o.x + o.width / 2, FLOOR_Y + 0.01, o.y + o.height / 2);
  }

  private _applyStyle(o: RegionObj): void {
    const num = this._colorNum(o.color);
    o.fillMat.color?.set?.(num);
    const isSelected = this._selectedId === o.id;
    o.fillMat.opacity = isSelected ? REGION_FILL_OPACITY_SELECTED : REGION_FILL_OPACITY;
    o.borderMat.color?.set?.(num);
    o.borderMat.transparent = true;
    o.borderMat.opacity = REGION_BORDER_OPACITY;
    this._drawLabel(o);
  }

  private _drawLabel(o: RegionObj): void {
    if (!o.canvas) return;
    const ctx = o.canvas.getContext('2d');
    if (!ctx) return;
    o.canvas.width = 256; o.canvas.height = 64;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.id, 128, 32);
    if (o.labelTex) o.labelTex.needsUpdate = true;
  }

  private _create(id: string, init: RegionInit): RegionObj {
    const T = this._T;
    const group = new T.Group();
    const fillMat = new T.MeshBasicMaterial({ transparent: true, side: T.DoubleSide, depthWrite: false });
    const fill = new T.Mesh();
    fill.material = fillMat;
    const borderMat = new T.LineBasicMaterial({});
    const border = new T.LineLoop();
    border.material = borderMat;
    let canvas: HTMLCanvasElement | null = null;
    try { canvas = document.createElement('canvas'); } catch { canvas = null; }
    const labelTex = canvas ? new T.CanvasTexture(canvas) : null;
    const labelMat = new T.SpriteMaterial({ map: labelTex, depthTest: false });
    const label = new T.Sprite();
    label.material = labelMat;
    label.scale.set(4, 1, 1);
    group.add(fill); group.add(border); group.add(label);
    const o: RegionObj = {
      id, x: init.x, y: init.y, width: init.width, height: init.height,
      color: init.color ?? '#00ff00', alpha: init.alpha ?? 1,
      group, fill, fillGeom: null, fillMat, border, borderGeom: null, borderMat,
      label, labelMat, labelTex, canvas,
    };
    this.group.add(group);
    return o;
  }

  upsert(id: string, init: RegionInit): void {
    let o = this._regions.get(id);
    if (!o) {
      o = this._create(id, init);
      this._regions.set(id, o);
      this._order.push(id);
    } else {
      o.x = init.x; o.y = init.y; o.width = init.width; o.height = init.height;
      if (init.color !== undefined) o.color = init.color;
      if (init.alpha !== undefined) o.alpha = init.alpha;
    }
    this._rebuildGeometry(o);
    this._applyStyle(o);
  }

  rename(oldId: string, newId: string): void {
    if (oldId === newId) return;
    const o = this._regions.get(oldId);
    if (!o) return;
    this._regions.delete(oldId);
    o.id = newId;
    this._regions.set(newId, o);
    this._order = this._order.map(i => (i === oldId ? newId : i));
    if (this._selectedId === oldId) this._selectedId = newId;
    this._drawLabel(o);
  }

  delete(id: string): void {
    const o = this._regions.get(id);
    if (!o) return;
    o.fillGeom?.dispose?.(); o.fillMat?.dispose?.();
    o.borderGeom?.dispose?.(); o.borderMat?.dispose?.();
    o.labelMat?.dispose?.(); o.labelTex?.dispose?.();
    o.group.removeFromParent?.();
    this._regions.delete(id);
    this._order = this._order.filter(i => i !== id);
    if (this._selectedId === id) this._selectedId = null;
  }

  getById(id: string): RegionRecord | null {
    const o = this._regions.get(id);
    return o ? { id: o.id, x: o.x, y: o.y, width: o.width, height: o.height, color: o.color, alpha: o.alpha } : null;
  }

  list(): RegionRecord[] {
    return this._order.map(id => this.getById(id)!).filter(Boolean);
  }

  setVisible(v: boolean): void { this.group.visible = v; }

  hitTest(wx: number, wz: number): string | null {
    for (let i = this._order.length - 1; i >= 0; i--) {
      const o = this._regions.get(this._order[i])!;
      if (wx >= o.x && wx <= o.x + o.width && wz >= o.y && wz <= o.y + o.height) return o.id;
    }
    return null;
  }

  /** Underlying fill mesh — TransformControls attaches here so translate moves
   *  the mesh center and scale grows/shrinks the rect from the center. */
  getMesh(id: string): any | null {
    return this._regions.get(id)?.fill ?? null;
  }

  /** Mark a region as selected (or clear with null). Re-applies style on both
   *  the previous and new selection so the highlight follows the selection. */
  setSelected(id: string | null): void {
    const prev = this._selectedId;
    if (prev === id) return;
    this._selectedId = id;
    if (prev) {
      const po = this._regions.get(prev);
      if (po) this._applyStyle(po);
    }
    if (id) {
      const no = this._regions.get(id);
      if (no) this._applyStyle(no);
    }
  }

  getSelectedId(): string | null { return this._selectedId; }

  dispose(): void {
    for (const id of [...this._order]) this.delete(id);
  }
}
