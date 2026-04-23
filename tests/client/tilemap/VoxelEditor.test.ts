import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoxelEditor } from '../../../engine/client/renderer/tilemap/VoxelEditor';
import { EventEmitter } from '../../../engine/core/events/EventEmitter';
import type { TiledMap } from '../../../engine/client/renderer/tilemap/VoxelTileMap';

// Build a minimal TiledMap fixture with a single tile layer, all zeros.
function makeMap(w: number, h: number, existing?: number[]): TiledMap {
  const data = existing ?? new Array(w * h).fill(0);
  return {
    width: w,
    height: h,
    tilewidth: 64,
    tileheight: 64,
    layers: [
      { name: 'ground', type: 'tilelayer', data, width: w, height: h, visible: true, opacity: 1 },
    ],
    tilesets: [],
  };
}

// Mock VoxelTileMap — records mutations so we can assert on them, ignores rendering.
function makeVoxelTileMapMock(map: TiledMap) {
  const updates: Array<{ layer: number; x: number; y: number; gid: number }> = [];
  return {
    loaded: true,
    group: { add: () => {}, remove: () => {}, children: [] },
    updateTile(layer: number, x: number, y: number, gid: number) {
      updates.push({ layer, x, y, gid });
      if (map.layers[layer].data) map.layers[layer].data![y * map.width + x] = gid;
    },
    rebuildLayer() {},
    clearLayer(layer: number) {
      if (map.layers[layer].data) {
        for (let i = 0; i < map.layers[layer].data!.length; i++) map.layers[layer].data![i] = 0;
      }
    },
    hideLayer() {},
    getTile(layer: number, x: number, y: number) {
      return map.layers[layer]?.data?.[y * map.width + x] ?? 0;
    },
    renderPreview() {},
    clearPreview() {},
    calcLayerCenterY() { return 0; },
    calcLayerTopY() { return 0; },
    calcLayerY() { return 0; },
    updates,
  };
}

function makeEditor(map: TiledMap) {
  const events = new EventEmitter();
  const transport = { send: vi.fn() };
  const tm = makeVoxelTileMapMock(map);
  const editor = new VoxelEditor({
    scene: { add: () => {} } as any,
    camera: { position: { x: 0, y: 0, z: 0 } } as any,
    voxelTileMap: tm as any,
    events,
    mapData: map,
    transport,
    gameId: 'test',
  });
  return { editor, events, transport, tm };
}

describe('VoxelEditor.putTiles (rectangle brush)', () => {
  it('stamps a single tile at (tx, ty) and mutates map data', () => {
    const map = makeMap(10, 10);
    const { editor, tm } = makeEditor(map);
    editor.putTiles(3, 4, { 3: { 4: 42 } }, { x: 1, y: 1 }, 'rectangle', 0, false);
    expect(map.layers[0].data![4 * 10 + 3]).toBe(42);
    expect(tm.updates).toEqual([{ layer: 0, x: 3, y: 4, gid: 42 }]);
  });

  it('tiles a 1x1 source across a 3x3 brush', () => {
    const map = makeMap(10, 10);
    const { editor } = makeEditor(map);
    editor.putTiles(2, 2, { 2: { 2: 5 } }, { x: 3, y: 3 }, 'rectangle', 0, false);
    for (let dx = 0; dx < 3; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        expect(map.layers[0].data![(2 + dy) * 10 + (2 + dx)]).toBe(5);
      }
    }
  });

  it('clips brush at map edge', () => {
    const map = makeMap(5, 5);
    const { editor } = makeEditor(map);
    // 3x3 brush anchored near the bottom-right edge → should only write visible cells.
    editor.putTiles(4, 4, { 4: { 4: 9 } }, { x: 3, y: 3 }, 'rectangle', 0, false);
    // (4,4) is the only in-bounds cell of the 3x3 footprint.
    expect(map.layers[0].data![4 * 5 + 4]).toBe(9);
    // Out-of-bounds writes are skipped.
    expect(map.layers[0].data!.filter((v) => v === 9).length).toBe(1);
  });

  it('eraser (-1 gid) writes 0 to the layer data', () => {
    const map = makeMap(5, 5);
    map.layers[0].data![2 * 5 + 2] = 7;
    const { editor } = makeEditor(map);
    editor.putTiles(2, 2, { 2: { 2: -1 } }, { x: 1, y: 1 }, 'rectangle', 0, false);
    expect(map.layers[0].data![2 * 5 + 2]).toBe(0);
  });

  it('emits EditTile network message when not local', () => {
    const map = makeMap(5, 5);
    const { editor, transport } = makeEditor(map);
    editor.putTiles(1, 1, { 1: { 1: 3 } }, { x: 1, y: 1 }, 'rectangle', 0, false);
    expect(transport.send).toHaveBeenCalledOnce();
    const msg = transport.send.mock.calls[0][0] as { data: { edit: unknown } };
    expect(msg).toHaveProperty('data.edit');
  });

  it('does not emit network message when local=true', () => {
    const map = makeMap(5, 5);
    const { editor, transport } = makeEditor(map);
    editor.putTiles(1, 1, { 1: { 1: 3 } }, { x: 1, y: 1 }, 'rectangle', 0, true);
    expect(transport.send).not.toHaveBeenCalled();
  });
});

describe('VoxelEditor.floodFill (BFS)', () => {
  it('fills an enclosed region of zeros with a new gid', () => {
    const w = 5, h = 5;
    const data = new Array(w * h).fill(0);
    // Walls of 1s around a 3x3 interior at (1..3, 1..3).
    for (let i = 0; i < w; i++) { data[0 * w + i] = 1; data[(h - 1) * w + i] = 1; }
    for (let j = 0; j < h; j++) { data[j * w + 0] = 1; data[j * w + (w - 1)] = 1; }
    const map = makeMap(w, h, data);
    const { editor } = makeEditor(map);
    editor.floodFill(0, 0, 9, 2, 2, false);
    // Interior cells got gid 9.
    for (let x = 1; x <= 3; x++) {
      for (let y = 1; y <= 3; y++) {
        expect(map.layers[0].data![y * w + x]).toBe(9);
      }
    }
    // Walls unchanged.
    expect(map.layers[0].data![0]).toBe(1);
  });

  it('is a no-op when oldTile === newTile', () => {
    const map = makeMap(3, 3);
    const { editor, transport } = makeEditor(map);
    editor.floodFill(0, 0, 0, 1, 1, false);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('emits EditTile {fill} when not fromServer', () => {
    const map = makeMap(3, 3);
    const { editor, transport } = makeEditor(map);
    editor.floodFill(0, 0, 4, 0, 0, false);
    expect(transport.send).toHaveBeenCalled();
    const msg = transport.send.mock.calls[0][0] as { data: { fill: unknown } };
    expect(msg).toHaveProperty('data.fill');
  });
});

describe('VoxelEditor undo/redo', () => {
  let editor: VoxelEditor;
  let map: TiledMap;
  beforeEach(() => {
    map = makeMap(5, 5);
    editor = makeEditor(map).editor;
    editor.setActive(true);
  });

  it('stamp → undo restores zero', () => {
    editor.cmd.addCommand({
      func: () => editor.putTiles(1, 1, { 1: { 1: 9 } }, { x: 1, y: 1 }, 'rectangle', 0, true),
      undo: () => editor.putTiles(1, 1, { 1: { 1: -1 } }, { x: 1, y: 1 }, 'rectangle', 0, true),
    });
    expect(map.layers[0].data![1 * 5 + 1]).toBe(9);
    editor.cmd.undo();
    expect(map.layers[0].data![1 * 5 + 1]).toBe(0);
  });

  it('undo then redo restores the stamp', () => {
    editor.cmd.addCommand({
      func: () => editor.putTiles(2, 2, { 2: { 2: 5 } }, { x: 1, y: 1 }, 'rectangle', 0, true),
      undo: () => editor.putTiles(2, 2, { 2: { 2: -1 } }, { x: 1, y: 1 }, 'rectangle', 0, true),
    });
    editor.cmd.undo();
    editor.cmd.redo();
    expect(map.layers[0].data![2 * 5 + 2]).toBe(5);
  });
});

describe('VoxelEditor.applyRemoteEdit', () => {
  it('applies an edit payload without emitting network messages', () => {
    const map = makeMap(3, 3);
    const { editor, transport } = makeEditor(map);
    editor.applyRemoteEdit({
      edit: {
        layer: [0],
        selectedTiles: [{ 0: { 0: 7 } }],
        size: { x: 1, y: 1 },
        shape: 'rectangle',
        x: 0,
        y: 0,
      },
    });
    expect(map.layers[0].data![0]).toBe(7);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('applies a clear payload', () => {
    const map = makeMap(3, 3, [1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const { editor } = makeEditor(map);
    editor.applyRemoteEdit({ clear: { layer: 0, layerName: 'ground' } });
    expect(map.layers[0].data!.every((v) => v === 0)).toBe(true);
  });
});

describe('VoxelEditor event subscriptions', () => {
  it('brush event switches active tool', () => {
    const map = makeMap(3, 3);
    const { editor, events } = makeEditor(map);
    events.emit('brush');
    expect(editor.activeTool).toBe('brush');
  });

  it('eraser event switches active tool', () => {
    const map = makeMap(3, 3);
    const { editor, events } = makeEditor(map);
    events.emit('empty-tile');
    expect(editor.activeTool).toBe('eraser');
  });

  it('increase-brush-size grows the brush', () => {
    const map = makeMap(3, 3);
    const { editor, events } = makeEditor(map);
    expect(editor.brushSize).toBe(1);
    events.emit('increase-brush-size');
    expect(editor.brushSize).toBe(2);
  });

  it('switch-layer changes currentLayerIndex', () => {
    const w = 3, h = 3;
    const map: TiledMap = {
      width: w, height: h, tilewidth: 64, tileheight: 64,
      layers: [
        { name: 'a', type: 'tilelayer', data: new Array(w * h).fill(0), width: w, height: h },
        { name: 'b', type: 'tilelayer', data: new Array(w * h).fill(0), width: w, height: h },
      ],
      tilesets: [],
    };
    const { editor, events } = makeEditor(map);
    events.emit('switch-layer', 1);
    expect(editor.currentLayerIndex).toBe(1);
  });
});
