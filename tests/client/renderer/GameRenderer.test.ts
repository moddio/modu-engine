import { describe, it, expect, beforeEach } from 'vitest';
import { GameRenderer } from '../../../engine/client/renderer/GameRenderer';

/**
 * Regression: server flow for placeholder cleanup (e.g. celleater) sends
 *   EntityCreate(placeholder) → EntityDestroy(placeholder) on the same client tick.
 * GameRenderer.createEntity loads the sprite texture asynchronously, so the mesh
 * isn't in `_entities` when destroyEntity runs — destroyEntity used to no-op, then
 * the texture would finish loading and add the mesh to the scene with no future
 * destroy ever coming. Result: a permanent ghost cell at the placeholder's broadcast
 * position (top-left of the map for celleater, since spawnUnit broadcasts before
 * _onJoinGame moves the unit to map center).
 *
 * The fix: track in-flight createEntity calls and have destroyEntity cancel them so
 * the load callback bails before touching the scene.
 */

class FakeVector3 {
  x = 0; y = 0; z = 0;
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s: number) { this.x = this.y = this.z = s; return this; }
  clone() { const v = new FakeVector3(); v.set(this.x, this.y, this.z); return v; }
}

class FakeColor { constructor(public value?: any) {} }

class FakeObject3D {
  parent: FakeObject3D | null = null;
  children: FakeObject3D[] = [];
  position = new FakeVector3();
  rotation = new FakeVector3();
  scale = new FakeVector3();
  name = '';
  visible = true;
  add(child: FakeObject3D) { child.parent = this; this.children.push(child); }
  removeFromParent() {
    if (this.parent) {
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
      this.parent = null;
    }
  }
  traverse(fn: (o: any) => void) {
    fn(this);
    for (const c of this.children) c.traverse(fn);
  }
}

class FakeScene extends FakeObject3D {
  background: any = null;
  fog: any = null;
}

class FakeMesh extends FakeObject3D { material: any = null; geometry: any = null; }

/** Asynchronous texture loader that lets the test trigger the load callback manually. */
type LoadEntry = { url: string; onLoad: (texture: any) => void; onErr?: (e: any) => void };
class ControlledTextureLoader {
  static pending: LoadEntry[] = [];
  setCrossOrigin() {}
  load(url: string, onLoad: (t: any) => void, _onProgress: any, onErr?: (e: any) => void) {
    ControlledTextureLoader.pending.push({ url, onLoad, onErr });
  }
}

const fakeTHREE: any = {
  Vector3: FakeVector3,
  Vector2: class { x = 0; y = 0; set(a: number, b: number) { this.x = a; this.y = b; } },
  Color: FakeColor,
  Scene: FakeScene,
  AmbientLight: FakeObject3D,
  DirectionalLight: class extends FakeObject3D { shadow: any = { mapSize: { width: 0, height: 0 }, camera: {} }; castShadow = false; },
  WebGLRenderer: class {
    domElement: any = { style: {}, remove() {}, addEventListener() {}, removeEventListener() {} };
    shadowMap: any = { enabled: false, type: null };
    toneMapping: any = null;
    toneMappingExposure = 1;
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
  },
  PCFSoftShadowMap: 'pcf',
  ACESFilmicToneMapping: 'aces',
  SRGBColorSpace: 'srgb',
  NearestFilter: 'nearest',
  DoubleSide: 'double',
  PlaneGeometry: class { constructor(public w: number, public h: number) {} dispose() {} },
  BoxGeometry: class { constructor() {} dispose() {} },
  MeshBasicMaterial: class {
    constructor(opts: any) { Object.assign(this, opts); }
    dispose() {}
  },
  MeshStandardMaterial: class { constructor(opts: any) { Object.assign(this, opts); } dispose() {} },
  Mesh: class extends FakeMesh {
    constructor(geo: any, mat: any) { super(); this.geometry = geo; this.material = mat; }
  },
  TextureLoader: ControlledTextureLoader,
  CubeTextureLoader: class { load() {} },
  // Real three.js exposes a global resource Cache; the renderer opts into it so
  // repeated/concurrent loads of the same sprite/model URL are deduped instead
  // of flooding the browser connection pool (single-player "delay" bug).
  Cache: { enabled: false },
  Box3: class { setFromObject() { return this; } getSize(v: FakeVector3) { v.set(1, 1, 1); return v; } },
  Fog: class { constructor() {} },
  AnimationMixer: class { clipAction() { return { play() {}, fadeOut() {}, fadeIn() {}, reset() { return this; } }; } update() {} existingAction() { return null; } },
  CanvasTexture: class { dispose() {} },
  SpriteMaterial: class { constructor(opts: any) { Object.assign(this, opts); } },
  Sprite: class extends FakeObject3D {
    center = { x: 0.5, y: 0.5, set(x: number, y: number) { this.x = x; this.y = y; } };
    constructor(public mat: any) { super(); }
  },
  Plane: class { constructor() {} },
  Raycaster: class { setFromCamera() {} ray = { intersectPlane() { return null; } }; },
};

class FakeCamera {
  threeCamera: any = {};
  azimuth = 0;
  elevation = 0;
  distance = 10;
  followTarget: any = null;
  attachControls() { return () => {}; }
  resize() {}
  setTarget() {}
  follow() {}
  unfollow() {}
  update() {}
  setControls() {}
}

function makeRenderer(gameDataOverride?: Record<string, any>): GameRenderer {
  const engine = {
    THREE: fakeTHREE,
    CameraController: FakeCamera,
    GLTFLoader: class { load() {} },
    VoxelTileMap: class {},
  };
  // Container with a no-op appendChild so the WebGLRenderer's domElement attach is harmless.
  const container: any = { appendChild() {}, removeChild() {} };
  // Minimal globalThis polyfills the constructor reaches for.
  (globalThis as any).window = (globalThis as any).window || {
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {},
  };
  // _addNameLabel uses canvas + 2d context for the name label sprite. Stub it.
  (globalThis as any).document = (globalThis as any).document || {
    createElement(tag: string) {
      if (tag !== 'canvas') return {};
      return {
        width: 0, height: 0,
        getContext() {
          return {
            measureText: () => ({ width: 100 }),
            font: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
            strokeText() {}, fillText() {},
          };
        },
      };
    },
  };
  const gameData = { map: { width: 40, height: 40, tilewidth: 64 }, ...(gameDataOverride || {}) };
  const cameraConfig = {};
  return new GameRenderer(container, gameData as any, cameraConfig as any, engine);
}

describe('GameRenderer asset cache', () => {
  // Regression for the single-player "delay": projectiles/inventory icons only
  // appeared "after a while" / "never" because every entity spawn re-fetched the
  // same sprite URL with THREE.Cache disabled (its default), saturating the
  // browser's per-host connection limit. The renderer must turn the cache on so
  // three's ImageLoader/FileLoader dedupe repeated + in-flight loads per URL.
  it('enables THREE.Cache so duplicate sprite/model fetches are deduped', () => {
    fakeTHREE.Cache.enabled = false;
    makeRenderer();
    expect(fakeTHREE.Cache.enabled).toBe(true);
  });
});

describe('GameRenderer create/destroy race', () => {
  beforeEach(() => { ControlledTextureLoader.pending = []; });

  it('placeholder destroyed before texture load completes does not leak a ghost mesh', () => {
    const renderer = makeRenderer();
    const scene = renderer.scene as FakeScene;
    const sceneCountBefore = scene.children.length;

    // Emulate the celleater placeholder: a sprite-based unit, broadcast at (0, 0).
    const placeholderId = 'placeholder_xyz';
    renderer.createEntity({
      classId: 'unit',
      entityId: placeholderId,
      x: 0, y: 0, rotation: 0,
      stats: {
        cellSheet: { url: 'https://example.com/cell.png' },
        bodies: { default: { width: 32, height: 32 } },
      },
    });

    expect(ControlledTextureLoader.pending).toHaveLength(1);
    expect(renderer.hasEntity(placeholderId)).toBe(false); // mesh not yet added — texture still loading

    // Server's playerCameraTrackUnit destroys the placeholder before the load finishes.
    renderer.destroyEntity(placeholderId);

    // Now the texture finishes loading. Without the fix, this would add the mesh to
    // the scene as a permanent ghost.
    const fakeTexture = { dispose() { (this as any).disposed = true; } };
    ControlledTextureLoader.pending[0].onLoad(fakeTexture);

    expect(renderer.hasEntity(placeholderId)).toBe(false);
    expect(scene.children.length).toBe(sceneCountBefore);
    expect((fakeTexture as any).disposed).toBe(true);
  });

  // Regression for "food spawns at first frame, but disposes soon after" reported in
  // celleater after the placeholder-cancel fix landed. Items follow exactly the same
  // codepath as the placeholder (image-sprite branch), so an over-eager bail in the
  // load callback would manifest as ghost food disappearing immediately. Verifies that
  // food meshes survive the placeholder-destroy flow happening at the same client tick.
  it('food items survive when placeholder is destroyed in the same tick', () => {
    const renderer = makeRenderer();
    const scene = renderer.scene as FakeScene;
    const sceneCountBefore = scene.children.length;

    const placeholderId = 'placeholder_xyz';
    const realCellId = 'real_cell_abc';
    const foodIds = ['itm_food1', 'itm_food2', 'itm_food3'];

    // Server flow on join: spawnUnit broadcasts placeholder, then stream broadcasts food
    // (initialize-time entities), then script's createUnitAtPosition broadcasts realCell,
    // then camera:trackUnit broadcasts EntityDestroy(placeholder).
    renderer.createEntity({
      classId: 'unit', entityId: placeholderId,
      x: 0, y: 0, rotation: 0,
      stats: { cellSheet: { url: 'https://example.com/cell.png' }, bodies: { default: { width: 32, height: 32 } } },
    });
    for (const id of foodIds) {
      renderer.createEntity({
        classId: 'item', entityId: id,
        x: 5, y: 5, rotation: 0,
        stats: { cellSheet: { url: 'https://example.com/food.png' }, bodies: { dropped: { width: 13, height: 13 } } },
      });
    }
    renderer.createEntity({
      classId: 'unit', entityId: realCellId,
      x: 20, y: 20, rotation: 0,
      stats: { cellSheet: { url: 'https://example.com/cell.png' }, bodies: { default: { width: 32, height: 32 } } },
    });
    renderer.destroyEntity(placeholderId);

    // 5 loads in flight: placeholder + 3 food + realCell.
    expect(ControlledTextureLoader.pending).toHaveLength(5);

    // Resolve all loads in the order they were queued.
    for (const entry of ControlledTextureLoader.pending) {
      entry.onLoad({ dispose() {} });
    }

    // Placeholder must NOT be in the scene; food + real cell MUST be.
    expect(renderer.hasEntity(placeholderId)).toBe(false);
    for (const id of foodIds) {
      expect(renderer.hasEntity(id), `food ${id} should be visible`).toBe(true);
    }
    expect(renderer.hasEntity(realCellId)).toBe(true);
    // 3 food + 1 real cell = 4 entity meshes added (ignoring any name label children).
    // The scene should NOT contain the placeholder mesh.
    const placeholderMesh = scene.children.find((c) => c.name === `entity_${placeholderId}`);
    expect(placeholderMesh).toBeUndefined();
  });

  // User report + screenshot: holding 1 meat then picking up more leaves TWO
  // overlapping meat sprites stuck on the unit's hand (inventory slot is correct
  // at x4, but the held sprite is doubled). A stack-pickup bumps quantity without
  // changing the slot's item id, so multiple inventory broadcasts arrive in quick
  // succession. _updateHeldItemSprite loads the held texture asynchronously and
  // only disposes the *already-tracked* sprite — a second call before the first
  // load resolves starts a second load, and both completed loads append a mesh to
  // the unit while only the last is tracked. The earlier mesh leaks forever. The
  // existing `currentHeld.id !== heldId` bail can't catch this because a stack
  // pickup keeps the same slot id.
  it('rapid same-id inventory updates do not leave a duplicate held-item sprite', () => {
    const meatType = {
      cellSheet: { url: 'https://example.com/meat.png', columnCount: 1, rowCount: 1 },
      bodies: { selected: { width: 16, height: 16 } },
    };
    const renderer = makeRenderer({ itemTypes: { meat: meatType } });
    const scene = renderer.scene as FakeScene;

    const unitId = 'u1';
    renderer.createEntity({
      classId: 'unit',
      entityId: unitId,
      x: 0, y: 0, rotation: 0,
      stats: {
        cellSheet: { url: 'https://example.com/cell.png' },
        bodies: { default: { width: 32, height: 32 } },
      },
    } as any);

    // Resolve the unit's own sprite load so the unit mesh exists (held-item
    // sprites attach as children of it).
    expect(ControlledTextureLoader.pending).toHaveLength(1);
    ControlledTextureLoader.pending[0].onLoad({ dispose() {} });
    const unitMesh = scene.children.find((c) => c.name === `entity_${unitId}`)!;
    expect(unitMesh).toBeDefined();

    // Two inventory broadcasts for the SAME held slot id (a stack pickup bumping
    // quantity), arriving before the first held-item texture finishes loading.
    renderer.updateEntityStats(unitId, { inventory: [{ id: 'm1', type: 'meat' }], currentSlot: 0 });
    renderer.updateEntityStats(unitId, { inventory: [{ id: 'm1', type: 'meat', quantity: 2 }], currentSlot: 0 });

    // Both held-item loads are now in flight (indices 1 and 2). Resolve them in order.
    expect(ControlledTextureLoader.pending.length).toBe(3);
    ControlledTextureLoader.pending[1].onLoad({ dispose() {} });
    ControlledTextureLoader.pending[2].onLoad({ dispose() {} });

    // Exactly one held-item mesh must be parented to the unit — not two.
    const heldChildren = unitMesh.children.filter((c: any) => c._unitId === unitId);
    expect(heldChildren.length).toBe(1);
  });

  // End-to-end faithful repro of the user's exact flow against the REAL meat
  // itemType (states.selected.body="selected", unselected="none") and the exact
  // server broadcast order on a stack pickup: held-update → world-meat create →
  // stack-quantity bump (same record id) → world-meat EntityDestroy. The unit
  // must end with exactly ONE mounted meat sprite and the world meat gone.
  it('hold 1 meat, pick up 1 (stack): unit keeps exactly one mounted meat sprite, world copy removed', () => {
    const MEAT = 'M94GUBy6iN';
    const meatType = {
      name: 'Meat',
      states: {
        selected: { body: 'selected' },
        unselected: { body: 'none' },
        dropped: { body: 'dropped' },
      },
      bodies: {
        selected: { width: 0.5, height: 0.5, spriteScale: 1, unitAnchor: { x: 0, y: 0, rotation: 0 }, itemAnchor: { x: 0, y: 0.0097 } },
        dropped: { width: 0.5, height: 0.5 },
      },
      cellSheet: { url: 'https://example.com/meat.png', rowCount: 1, columnCount: 1 },
      controls: { mouseBehaviour: { rotateToFaceMouseCursor: true } },
    };
    const renderer = makeRenderer({ itemTypes: { [MEAT]: meatType } });
    const scene = renderer.scene as FakeScene;
    // Drain iteratively: a load's onLoad can queue further loads (the unit
    // texture's callback is what queues the held-item texture), exactly as the
    // real async loader resolves them across ticks.
    const resolveAll = () => {
      for (let i = 0; i < 20 && ControlledTextureLoader.pending.length; i++) {
        for (const p of ControlledTextureLoader.pending.splice(0)) p.onLoad({ dispose() {} });
      }
    };

    const unitId = 'slayer';
    // Unit spawns already holding one meat in the selected slot.
    renderer.createEntity({
      classId: 'unit', entityId: unitId, x: 0, y: 0, rotation: 0,
      stats: {
        cellSheet: { url: 'https://example.com/cell.png' },
        bodies: { default: { width: 32, height: 32 } },
        inventory: [{ id: 'rec_meat', type: MEAT, quantity: 1 }],
        currentSlot: 0,
        currentItemId: 'rec_meat',
      },
    } as any);
    resolveAll(); // unit texture + the held meat texture
    const unitMesh = scene.children.find((c) => c.name === `entity_${unitId}`)!;
    const meatSprites = () => unitMesh.children.filter((c: any) => c._unitId === unitId && c._typeId === MEAT);
    expect(meatSprites().length).toBe(1);

    // A second meat lies in the world.
    renderer.createEntity({
      classId: 'item', entityId: 'itm_world', x: 1, y: 0, rotation: 0,
      stats: { ...meatType, type: MEAT, quantity: 1 },
    } as any);

    // Server stack-pickup: quantity bumps on the SAME record id, then the world
    // copy is destroyed. Two stats deltas arrive before textures settle (sync +
    // the pickup script), the classic duplicate trigger.
    renderer.updateEntityStats(unitId, { inventory: [{ id: 'rec_meat', type: MEAT, quantity: 2 }], currentSlot: 0, currentItemId: 'rec_meat' });
    renderer.updateEntityStats(unitId, { inventory: [{ id: 'rec_meat', type: MEAT, quantity: 2 }], currentSlot: 0, currentItemId: 'rec_meat' });
    renderer.destroyEntity('itm_world');
    resolveAll();

    // Exactly one meat sprite on the hand; the world meat is gone.
    expect(meatSprites().length, 'unit must show exactly one meat sprite').toBe(1);
    expect(renderer.hasEntity('itm_world'), 'picked-up world meat must be removed').toBe(false);
  });

  it('successful create followed by destroy still works (sanity check, no race)', () => {
    const renderer = makeRenderer();
    const scene = renderer.scene as FakeScene;
    const sceneCountBefore = scene.children.length;

    const id = 'cell_real';
    renderer.createEntity({
      classId: 'unit',
      entityId: id,
      x: 5, y: 7, rotation: 0,
      stats: {
        cellSheet: { url: 'https://example.com/cell.png' },
        bodies: { default: { width: 32, height: 32 } },
      },
    });

    // Texture loads first — mesh enters the scene.
    ControlledTextureLoader.pending[0].onLoad({ dispose() {} });
    expect(renderer.hasEntity(id)).toBe(true);
    expect(scene.children.length).toBe(sceneCountBefore + 1);

    // Then the entity is destroyed normally.
    renderer.destroyEntity(id);
    expect(renderer.hasEntity(id)).toBe(false);
    expect(scene.children.length).toBe(sceneCountBefore);
  });
});
