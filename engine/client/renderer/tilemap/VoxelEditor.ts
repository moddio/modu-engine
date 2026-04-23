import * as THREE from 'three';
import { EventEmitter, EventHandle } from '../../../core/events/EventEmitter';
import { MessageType, EditTilePayload } from '../../../core/protocol/Messages';
import type { VoxelTileMap, TiledMap } from './VoxelTileMap';
import { VoxelMarker, MarkerMode } from './VoxelMarker';
import { CommandController } from './CommandController';
import { TileShape } from './TileShape';

export type EditorTool = 'cursor' | 'brush' | 'eraser' | 'fill' | 'entity' | 'region';

/** Palette mode string — the React palette emits either 'TILE' or 'ANIMATEDTILE'. */
export type TileMode = 'TILE' | 'ANIMATEDTILE' | string;

export interface VoxelEditorTransport {
  send(msg: { type: string; data: unknown }): void;
}

export interface VoxelEditorDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  voxelTileMap: VoxelTileMap;
  events: EventEmitter;
  mapData: TiledMap;
  transport?: VoxelEditorTransport | null;
  gameId?: string;
  apiUrl?: string;
  /** Called when this client is a developer (server-side gate is authoritative). */
  isDeveloper?: boolean;
  /** Optional global `window` for fetch; injected for tests. */
  fetchImpl?: typeof fetch;
}

interface PendingSelection {
  tileX: number;
  tileY: number;
  selectedTiles: Record<number, Record<number, number>>;
  layer: number;
}

/**
 * Coordinator for voxel-map editing tools (stamp, eraser, fill) on top of a `VoxelTileMap`.
 *
 * Subscribes to editor events on the shared `EventEmitter`, raycasts the floor under the pointer,
 * mutates layer data + rebuilds affected chunks, and (optionally) emits `EditTile` network messages.
 * Remote `MapUpdate` messages are applied via `applyRemoteEdit` (no local undo entry).
 */
export class VoxelEditor {
  readonly cmd: CommandController;
  readonly marker: VoxelMarker;
  readonly brushArea = new TileShape();

  activeTool: EditorTool = 'cursor';
  currentLayerIndex = 0;
  tileId = 1;
  brushSize = 1;
  leftButtonDown = false;
  active = false;
  tileMode: TileMode = 'TILE';

  private _deps: VoxelEditorDeps;
  private _handles: Array<{ event: string; handle: EventHandle }> = [];
  private _raycaster = new THREE.Raycaster();
  private _pointer = new THREE.Vector2();
  private _lastHoverTile: { x: number; y: number } | null = null;
  private _prevEditKey = '';
  private _pendingRemote: EditTilePayload[] = [];

  constructor(deps: VoxelEditorDeps) {
    this._deps = deps;
    this.marker = new VoxelMarker(deps.voxelTileMap);
    this.cmd = new CommandController({
      increaseBrushSize: () => {
        this.brushSize = Math.min(this.brushSize + 1, 32);
        this.brushArea.size = { x: this.brushSize, y: this.brushSize };
        this._refreshPreview();
      },
      decreaseBrushSize: () => {
        this.brushSize = Math.max(this.brushSize - 1, 1);
        this.brushArea.size = { x: this.brushSize, y: this.brushSize };
        this._refreshPreview();
      },
    });
    this.brushArea.size = { x: this.brushSize, y: this.brushSize };

    // Default to the first tile layer.
    const firstTileLayer = deps.mapData.layers.findIndex(
      (l) => l.type === 'tilelayer' && !!l.data,
    );
    this.currentLayerIndex = firstTileLayer >= 0 ? firstTileLayer : 0;

    this._subscribe();
  }

  // ======================================================================
  // Subscriptions
  // ======================================================================

  private _subscribe(): void {
    const on = (event: string, cb: (...args: unknown[]) => void) => {
      const handle = this._deps.events.on(event, cb);
      this._handles.push({ event, handle });
    };
    on('brush', () => this._setTool('brush'));
    on('empty-tile', () => this._setTool('eraser'));
    on('fill', () => this._setTool('fill'));
    on('cursor', () => this._setTool('cursor'));
    on('draw-region', () => this._setTool('region'));
    on('add-entities', () => this._setTool('entity'));
    on('undo', () => this.cmd.undo());
    on('redo', () => this.cmd.redo());
    on('increase-brush-size', () => this.cmd.defaultCommands.increaseBrushSize());
    on('decrease-brush-size', () => this.cmd.defaultCommands.decreaseBrushSize());
    on('switch-layer', (idx: unknown) => {
      if (typeof idx === 'number') this.switchLayer(idx);
    });
    on('hide-layer', (data: unknown) => {
      const d = data as { index: number; state: boolean } | undefined;
      if (d) this._deps.voxelTileMap.hideLayer(d.index, !!d.state);
    });
    on('clear', () => this._requestClearLayer());
    on('save', () => { void this.saveMap(); });
    on('updateMap', () => {
      if (!this._deps.mapData) return;
      for (let i = 0; i < this._deps.mapData.layers.length; i++) {
        const l = this._deps.mapData.layers[i];
        if (l.type === 'tilelayer' && l.data) {
          this._deps.voxelTileMap.rebuildLayer(i);
        }
      }
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.marker.clear();
  }

  dispose(): void {
    for (const { event, handle } of this._handles) this._deps.events.off(event, handle);
    this._handles.length = 0;
    this.marker.dispose();
  }

  // ======================================================================
  // Palette API — called by the React editor
  // ======================================================================

  setTileId(id: number): void {
    this.tileId = id;
    this._refreshPreview();
  }

  /**
   * Called by the React palette when switching between regular and animated-tile palettes.
   * Stored so downstream systems can dispatch on it; does not otherwise change behavior.
   */
  setTileMode(mode: TileMode): void {
    this.tileMode = mode;
    this._deps.events.emit('editor:tile-mode-change', mode);
  }

  setBrushSize(n: number): void {
    this.brushSize = Math.max(1, Math.min(32, Math.floor(n)));
    this.brushArea.size = { x: this.brushSize, y: this.brushSize };
    this._refreshPreview();
  }

  switchLayer(layer: number): void {
    if (layer === this.currentLayerIndex) return;
    this.currentLayerIndex = layer;
    this._deps.events.emit('editor:layer-switched', layer);
    this._refreshPreview();
  }

  // ======================================================================
  // Pointer lifecycle (driven by the host renderer)
  // ======================================================================

  onPointerMove(ndcX: number, ndcY: number): void {
    this._pointer.set(ndcX, ndcY);
    if (!this.active) return;
    const tile = this._raycastTile();
    if (!tile) return;
    const changed = !this._lastHoverTile ||
      this._lastHoverTile.x !== tile.x || this._lastHoverTile.y !== tile.y;
    this._lastHoverTile = tile;

    if (this.activeTool === 'brush' || this.activeTool === 'eraser' || this.activeTool === 'fill') {
      this._emitHoverTooltip(tile);
      this._updateMarker(tile);
      if (changed && this.leftButtonDown &&
          (this.activeTool === 'brush' || this.activeTool === 'eraser')) {
        this._handleEdit(tile);
      }
    } else {
      this.marker.clear();
    }
  }

  onPointerDown(button: number): void {
    if (!this.active) return;
    if (button === 0) {
      this.leftButtonDown = true;
      if (!this._lastHoverTile) {
        const t = this._raycastTile();
        if (t) this._lastHoverTile = t;
      }
      if (!this._lastHoverTile) return;
      if (this.activeTool === 'brush' || this.activeTool === 'eraser' || this.activeTool === 'fill') {
        this._handleEdit(this._lastHoverTile);
      }
    } else if (button === 2) {
      this._handleRightClickCopy();
    }
  }

  onPointerUp(button: number): void {
    if (button === 0) {
      this.leftButtonDown = false;
      this._prevEditKey = '';
    }
  }

  onPointerLeave(): void {
    this.leftButtonDown = false;
    this._prevEditKey = '';
    this.marker.clear();
    this._lastHoverTile = null;
  }

  // ======================================================================
  // Internals — tool dispatch
  // ======================================================================

  private _setTool(tool: EditorTool): void {
    this.activeTool = tool;
    this.leftButtonDown = false;
    this._prevEditKey = '';
    this._refreshPreview();
  }

  private _raycastTile(): { x: number; y: number } | null {
    this._raycaster.setFromCamera(this._pointer, this._deps.camera);
    // Intersect with the top-face plane of the current layer (where placed tiles would sit).
    const topY = this._deps.voxelTileMap.calcLayerTopY(this.currentLayerIndex);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -topY);
    const hit = new THREE.Vector3();
    if (!this._raycaster.ray.intersectPlane(plane, hit)) return null;
    const tx = Math.floor(hit.x);
    const ty = Math.floor(hit.z);
    if (tx < 0 || ty < 0 || tx >= this._deps.mapData.width || ty >= this._deps.mapData.height) {
      return null;
    }
    return { x: tx, y: ty };
  }

  private _emitHoverTooltip(tile: { x: number; y: number }): void {
    const map = this._deps.mapData;
    const layer = map.layers[this.currentLayerIndex];
    const gid = layer?.data?.[tile.y * map.width + tile.x] ?? 0;
    this._deps.events.emit('update-tooltip', {
      label: 'Position',
      text: `Tile X: ${tile.x}, Tile Y: ${tile.y}   |   Tile id: ${gid}`,
    });
  }

  private _updateMarker(tile: { x: number; y: number }): void {
    const mode: MarkerMode =
      this.activeTool === 'eraser' ? 'eraser' :
      this.activeTool === 'brush' ? 'brush' :
      this.activeTool === 'fill'  ? 'brush' : 'none';
    this.marker.showAt(
      mode,
      tile.x,
      tile.y,
      this.currentLayerIndex,
      this.brushSize,
      this.brushSize,
      this.tileId,
    );
  }

  private _refreshPreview(): void {
    if (!this.active) return;
    if (!this._lastHoverTile) return;
    this._updateMarker(this._lastHoverTile);
  }

  private _handleEdit(tile: { x: number; y: number }): void {
    if (this.activeTool === 'brush' || this.activeTool === 'eraser') {
      this._stampOrErase(tile);
    } else if (this.activeTool === 'fill') {
      this._fillAt(tile);
    }
  }

  private _stampOrErase(tile: { x: number; y: number }): void {
    const layer = this.currentLayerIndex;
    const gid = this.activeTool === 'eraser' ? -1 : this.tileId;
    const selectedTiles: Record<number, Record<number, number>> = { [tile.x]: { [tile.y]: gid } };

    const key = `${tile.x}:${tile.y}:${gid}:${layer}:${this.brushSize}`;
    if (key === this._prevEditKey) return;
    this._prevEditKey = key;

    const oldTiles = this._snapshotArea(tile.x, tile.y, this.brushSize, this.brushSize, layer);
    const size = { x: this.brushSize, y: this.brushSize };
    this.cmd.addCommand({
      func: () => this.putTiles(tile.x, tile.y, selectedTiles, size, 'rectangle', layer, false),
      undo: () => this.putTiles(tile.x, tile.y, oldTiles, size, 'rectangle', layer, false),
    });
  }

  private _fillAt(tile: { x: number; y: number }): void {
    const layer = this.currentLayerIndex;
    const map = this._deps.mapData;
    const width = map.width;
    const oldTile = map.layers[layer]?.data?.[tile.y * width + tile.x] ?? 0;
    const newTile = this.tileId;
    if (oldTile === newTile) return;

    const cmdCache: Record<number, Record<number, number>> = {};
    const addToLimits = (v: { x: number; y: number }) => {
      if (!cmdCache[v.x]) cmdCache[v.x] = {};
      cmdCache[v.x][v.y] = 1;
    };
    this.cmd.addCommand({
      func: () => this.floodFill(layer, oldTile, newTile, tile.x, tile.y, false, {}, addToLimits),
      undo: () => this.floodFill(layer, newTile, oldTile, tile.x, tile.y, false, cmdCache, undefined, true),
      cache: cmdCache,
    });
  }

  private _handleRightClickCopy(): void {
    const tile = this._raycastTile();
    if (!tile) return;
    const map = this._deps.mapData;
    const gid = map.layers[this.currentLayerIndex]?.data?.[tile.y * map.width + tile.x] ?? 0;
    if (gid !== 0) {
      this.tileId = gid;
      this._deps.events.emit('editor:tile-copied', gid);
      this._refreshPreview();
    }
  }

  private _snapshotArea(
    tileX: number, tileY: number, w: number, h: number, layer: number,
  ): Record<number, Record<number, number>> {
    const map = this._deps.mapData;
    const data = map.layers[layer]?.data;
    const out: Record<number, Record<number, number>> = {};
    if (!data) return out;
    for (let sx = 0; sx < w; sx++) {
      const x = tileX + sx;
      if (x < 0 || x >= map.width) continue;
      const col: Record<number, number> = {};
      let any = false;
      for (let sy = 0; sy < h; sy++) {
        const y = tileY + sy;
        if (y < 0 || y >= map.height) continue;
        const v = data[y * map.width + x];
        col[y] = v === 0 ? -1 : v;
        any = true;
      }
      if (any) out[x] = col;
    }
    return out;
  }

  // ======================================================================
  // Mutation ops (public for tests + remote apply)
  // ======================================================================

  putTiles(
    tileX: number,
    tileY: number,
    selectedTiles: Record<number, Record<number, number>>,
    brushSize: { x: number; y: number } | 'fitContent',
    shape: 'rectangle',
    layer: number,
    local = false,
    isPreview = false,
  ): void {
    const map = this._deps.mapData;
    if (!map.layers[layer] || map.layers[layer].type !== 'tilelayer' || !map.layers[layer].data) return;

    const calc = this.brushArea.calcSample(selectedTiles, brushSize, shape);
    const sample = calc.sample;
    const effective = brushSize === 'fitContent'
      ? { x: calc.xLength, y: calc.yLength }
      : brushSize;
    const anchorX = brushSize === 'fitContent' ? calc.minX : tileX;
    const anchorY = brushSize === 'fitContent' ? calc.minY : tileY;

    for (let x = 0; x < effective.x; x++) {
      if (!sample[x]) continue;
      for (let y = 0; y < effective.y; y++) {
        const gid = sample[x]?.[y];
        if (gid === undefined) continue;
        const mx = anchorX + x;
        const my = anchorY + y;
        if (mx < 0 || my < 0 || mx >= map.width || my >= map.height) continue;
        const writeGid = gid < 0 ? 0 : gid;
        if (!isPreview) {
          this._deps.voxelTileMap.updateTile(layer, mx, my, writeGid);
        }
      }
    }

    if (!local && !isPreview && this._deps.transport) {
      const payload: EditTilePayload = {
        edit: {
          layer: [layer],
          selectedTiles: [selectedTiles],
          size: brushSize,
          shape,
          x: tileX,
          y: tileY,
          noMerge: true,
        },
      };
      this._deps.transport.send({ type: MessageType.EditTile, data: payload });
    }
  }

  floodFill(
    layer: number,
    oldTile: number,
    newTile: number,
    x: number,
    y: number,
    fromServer: boolean,
    limits?: Record<number, Record<number, number>>,
    addToLimits?: (v: { x: number; y: number }) => void,
    sendToServerWithLimits = false,
  ): void {
    const map = this._deps.mapData;
    const width = map.width;
    const height = map.height;
    const data = map.layers[layer]?.data;
    if (!data) return;
    if (oldTile === newTile) return;

    const open: Array<{ x: number; y: number }> = [{ x, y }];
    const closed: Record<number, Record<number, number>> = {};
    const selectedTiles: Record<number, Record<number, number>> = {};
    const normNew = newTile === 0 ? -1 : newTile;

    while (open.length) {
      const cur = open.shift()!;
      if (closed[cur.x]?.[cur.y]) continue;
      if (!closed[cur.x]) closed[cur.x] = {};
      closed[cur.x][cur.y] = 1;

      if (limits && limits[cur.x]?.[cur.y]) continue;
      const idx = cur.y * width + cur.x;
      if (cur.x < 0 || cur.y < 0 || cur.x >= width || cur.y >= height) continue;
      const here = data[idx];
      if (here !== oldTile && !(here === 0 && oldTile === 0)) {
        addToLimits?.(cur);
        continue;
      }

      if (!selectedTiles[cur.x]) selectedTiles[cur.x] = {};
      selectedTiles[cur.x][cur.y] = normNew;

      if (cur.x > 0) open.push({ x: cur.x - 1, y: cur.y });
      if (cur.x < width - 1) open.push({ x: cur.x + 1, y: cur.y });
      if (cur.y > 0) open.push({ x: cur.x, y: cur.y - 1 });
      if (cur.y < height - 1) open.push({ x: cur.x, y: cur.y + 1 });
    }

    if (Object.keys(selectedTiles).length === 0) return;
    this.putTiles(0, 0, selectedTiles, 'fitContent', 'rectangle', layer, true);

    if (!fromServer && this._deps.transport) {
      const payload: EditTilePayload = {
        fill: {
          layer,
          gid: newTile,
          x,
          y,
          limits: sendToServerWithLimits ? limits : undefined,
        },
      };
      this._deps.transport.send({ type: MessageType.EditTile, data: payload });
    }
  }

  clearLayer(layer: number, local = false): void {
    const map = this._deps.mapData;
    if (!map.layers[layer] || !map.layers[layer].data) return;
    this._deps.voxelTileMap.clearLayer(layer);
    if (!local && this._deps.transport) {
      const payload: EditTilePayload = {
        clear: { layer, layerName: map.layers[layer].name },
      };
      this._deps.transport.send({ type: MessageType.EditTile, data: payload });
    }
  }

  private _requestClearLayer(): void {
    const layer = this.currentLayerIndex;
    const map = this._deps.mapData;
    if (!map.layers[layer] || !map.layers[layer].data) return;

    const snapshot: Record<number, Record<number, number>> = {};
    for (let x = 0; x < map.width; x++) {
      const col: Record<number, number> = {};
      for (let y = 0; y < map.height; y++) {
        col[y] = map.layers[layer].data![y * map.width + x] || -1;
      }
      snapshot[x] = col;
    }

    this.cmd.addCommand({
      func: () => this.clearLayer(layer),
      undo: () => {
        this.putTiles(
          0, 0, snapshot, 'fitContent', 'rectangle', layer, false,
        );
      },
    });
  }

  // ======================================================================
  // Remote apply (inbound MapUpdate messages)
  // ======================================================================

  applyRemoteEdit(payload: EditTilePayload): void {
    if (!this._deps.voxelTileMap.loaded) {
      this._pendingRemote.push(payload);
      return;
    }
    if ('edit' in payload) {
      const { layer, selectedTiles, size, shape, x, y } = payload.edit;
      for (let i = 0; i < layer.length; i++) {
        this.putTiles(x, y, selectedTiles[i], size, shape, layer[i], true);
      }
    } else if ('fill' in payload) {
      const { layer, gid, x, y, limits } = payload.fill;
      const map = this._deps.mapData;
      const oldTile = map.layers[layer]?.data?.[y * map.width + x] ?? 0;
      this.floodFill(layer, oldTile, gid, x, y, true, limits);
    } else if ('clear' in payload) {
      this.clearLayer(payload.clear.layer, true);
    }
  }

  drainPendingRemote(): void {
    if (this._pendingRemote.length === 0) return;
    const pending = this._pendingRemote.slice();
    this._pendingRemote.length = 0;
    for (const p of pending) this.applyRemoteEdit(p);
  }

  // ======================================================================
  // Save to persistent store
  // ======================================================================

  async saveMap(): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
    const gameId = this._deps.gameId;
    if (!gameId) {
      const err = 'gameId missing';
      this._deps.events.emit('editor:save-error', err);
      return { ok: false, error: err };
    }
    const url = `${this._deps.apiUrl ?? ''}/api/games/${gameId}/map`;
    const fetchFn = this._deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchFn) {
      const err = 'fetch unavailable';
      this._deps.events.emit('editor:save-error', err);
      return { ok: false, error: err };
    }
    try {
      const res = await fetchFn(url, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layers: this._deps.mapData.layers }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = (body as { error?: string }).error || `HTTP ${res.status}`;
        this._deps.events.emit('editor:save-error', err);
        return { ok: false, error: err };
      }
      const body = await res.json() as { version?: string };
      this._deps.events.emit('editor:save-complete', body);
      return { ok: true, version: body.version ?? '' };
    } catch (e) {
      const err = (e as Error).message;
      this._deps.events.emit('editor:save-error', err);
      return { ok: false, error: err };
    }
  }
}
