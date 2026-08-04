/**
 * GameRenderer — handles all Three.js scene management.
 * Creates scene, camera, lights, tilemap. Renders entities from server state.
 * Zero game logic — only rendering.
 *
 * Lived as two hand-synced copies in `braains3d` and `packages/web` until they drifted
 * 101 lines apart, at which point the web copy was missing the 3D GLB sizing rules, the
 * extracted locomotion tracker and the jump arc. Its dependencies (THREE, the camera,
 * the tilemap, the GLTF loader) all live here, so this is where it belongs; the apps
 * take it off the engine bundle they already load.
 */
import * as RealTHREE from 'three';
import { GLTFLoader as RealGLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CameraController as RealCameraController } from './CameraController';
import { VoxelTileMap as RealVoxelTileMap } from './tilemap/index';
import { RegionLayer } from './RegionLayer';
import { RegionGizmo, type GizmoMode } from './RegionGizmo';
import { LocomotionTracker } from './locomotion';

export interface EntityRenderData {
  classId: string;
  entityId: string;
  x: number;
  y: number;
  rotation: number;
  stats: Record<string, any>;
}

export class GameRenderer {
  private _scene: any; // THREE.Scene
  private _camera: any; // CameraController
  private _renderer: any; // THREE.WebGLRenderer
  private _THREE: any;
  private _GLTFLoader: any;
  private _VoxelTileMap: any;
  private _TransformControls: any;
  private _container: HTMLElement;
  private _entities = new Map<string, any>(); // entityId → THREE.Object3D
  /** entityIds whose async texture load is still in flight. destroyEntity removes from
   *  here too, so a destroy arriving before the load completes cancels the load callback —
   *  otherwise the mesh would be added to the scene after destroyEntity already ran (which
   *  found nothing in `_entities`) and persist forever as a ghost. The classic repro is the
   *  server's placeholder unit (`_onJoinGame` spawns one and `playerCameraTrackUnit`
   *  destroys it on the same tick); without this the placeholder appears at its broadcast
   *  position (top-left corner of the map for celleater) and never goes away. */
  private _pendingCreates = new Set<string>();
  private _entityTargets = new Map<string, { x: number; z: number; height: number; ry: number }>(); // interpolation targets
  /** Derives idle↔run per entity from the authoritative targets (never the lerped
   *  position, which is asymptotic and never reads as exactly stopped). */
  private _locomotion = new LocomotionTracker();
  private _animationMixers: any[] = [];
  /** Per-unit inventory mirror — mirrors the `inventory` + `currentSlot` server stats so that
   *  the renderer can resolve the currently-held item type for any unit (not just the local
   *  player). The local player's inventory is *also* mirrored into React state in GameClient
   *  for the HUD bar; this map exists so other units' held weapons can be rendered too. */
  private _unitInventory = new Map<string, { items: Array<{ id?: string; type?: string }>; currentSlot: number }>();
  /** Per-unit mounted item sprites — children of the unit's THREE.Object3D, keyed
   *  by inventory-record id. A unit shows one sprite per inventory item whose
   *  current state resolves to a real body: the selected slot's item (state
   *  `selected`) plus every item whose `states.unselected.body` points at a real
   *  body — that's how Karmaslayers armour (`type:unusable`, `unselected.body =
   *  "selected"`) stays visible on the head/torso while a weapon is held, while
   *  weapons (`unselected.body = "none"`) vanish when not selected. Reconciled
   *  by record id so switching weapon slots doesn't tear down and reload the
   *  static armour sprite. Only attached for sprite-rendered (flat-plane) units;
   *  GLB-rendered 3D units would need bone attachment, which isn't wired up yet. */
  private _heldItemSprites = new Map<string, Map<string, any>>();
  /** Monotonic token guarding each async item texture load, keyed
   *  `${unitId}::${recId}`. Every _updateHeldItemSprite reconcile that (re)builds
   *  a record's sprite bumps its token and the load callback only attaches its
   *  mesh if its captured token is still current — so a newer call supersedes an
   *  in-flight load instead of leaking a second sprite. The slot-id bail can't
   *  cover this: a stack pickup bumps quantity (firing fresh inventory
   *  broadcasts) without changing the slot id, so both the stale and current
   *  loads share the same id. Mirrors `_pendingCreates`' cancellation pattern. */
  private _heldItemLoadToken = new Map<string, number>();
  /** Per-entity floating attribute bars (the `unitBar*` half of the `isVisible`
   *  semantic — `centerBar` is rendered in React HUD by GameClient). Source-of-truth
   *  is the `bars` array; sprite is created lazily once the entity's THREE object
   *  exists (handles the GLB/PNG async-load race) and refreshed in-place when bars
   *  change. */
  private _entityBars = new Map<string, {
    bars: Array<{ value: number; min: number; max: number; color: string }>;
    sprite: any | null;
    canvas: HTMLCanvasElement | null;
    texture: any | null;
  }>();
  /** Cursor world XZ from the latest mousemove. Used by the render loop to face held-item
   *  sprites toward the cursor when the item type has rotateToFaceMouseCursor. Null until
   *  the first mouse event arrives. */
  private _mouseWorldX: number | null = null;
  private _mouseWorldZ: number | null = null;
  /** Per-unit active use-tween for the held item. Mirrors taro's TweenComponent
   *  table (`gs/taro/src/gameClasses/components/TweenComponent.js`): the value goes
   *  0 → peak over `outMs`, then peak → 0 over `backMs`. `kind` selects between
   *  rotation (around the unit's hand) and translation along the item's local Y
   *  axis (poke = forward, recoil = backward). The server broadcasts the tween
   *  *name* in `useItem` (e.g. `swingCCW`, `recoil`); see `_triggerSwing`. */
  private _swingTweens = new Map<string, { startTime: number; kind: 'rotate' | 'translate'; outMs: number; backMs: number; peak: number }>();
  private _running = false;
  private _animFrameId = 0;
  private _lastTime = 0;
  private _gameData: Record<string, any>;
  private _detachControls: (() => void) | null = null;
  /** Tilemap group ref kept so `setLayerVisible` can toggle chunk visibility per layer
   *  after the editor emits `hide-layer`. VoxelTileMap names each chunk
   *  `chunk_${layer.name}_${cx}_${cy}` (see VoxelTileMap.ts), so layer membership is
   *  recovered by name prefix. */
  private _tileMapGroup: any = null;
  private _regionLayer: RegionLayer | null = null;
  private _regionGizmo: RegionGizmo | null = null;
  /** Region-tool mode set by GameClient when the editor selects the draw/cursor
   *  tool in the Map tab. null = region interaction off. */
  private _regionToolMode: 'draw' | 'cursor' | null = null;
  private _selectedRegionId: string | null = null;
  private _regionDrag: { kind: 'draw'; sx: number; sz: number } | null = null;
  /** Double-click detection (cursor mode). Match legacy taro literal 350ms
   *  (moddio2/.../Renderer.ts:387). */
  private _lastRegionClickAt = 0;
  private _lastRegionClickId: string | null = null;
  /** Saved camera control flags while a gizmo drag is active, so we can
   *  restore the user's exact pre-drag config on drag end. */
  private _camSavedControls: { pannable?: boolean; zoomable?: boolean; pointerLock?: boolean } | null = null;
  /** Set by GameClient. Coordinates are world tile units. */
  onRegionDrawComplete: ((rect: { x: number; y: number; width: number; height: number }) => void) | null = null;
  onRegionDoubleClicked: ((id: string) => void) | null = null;
  onRegionTransformComplete: ((id: string, rect: { x: number; y: number; width: number; height: number }) => void) | null = null;
  /** Bridge sets this; called whenever the selected region changes (including
   *  to null on deselect). Used by the bridge to emit `show-transform-modes`
   *  and `block-rotation` to the editor. */
  onRegionSelectionChanged: ((id: string | null) => void) | null = null;

  /**
   * `deps` overrides the rendering libraries this class builds on. Production passes
   * nothing and gets the real ones; the point of the seam is that the tests can hand it
   * a fake THREE and exercise entity lifecycle, sizing and locomotion in plain node with
   * no canvas and no WebGL. Deleting it in favour of bare imports would make every one
   * of those cases unrunnable.
   *
   * `TransformControls` has no default on purpose. `loadTilemap` runs for every game,
   * not just the editor, so defaulting it would construct a `RegionGizmo` on every boot
   * — a path that has never actually run, because it used to be read off the engine
   * bundle, which does not export it. Enabling it stays a deliberate act.
   */
  constructor(
    container: HTMLElement,
    gameData: Record<string, any>,
    cameraConfig: Record<string, any>,
    deps?: {
      THREE?: any;
      CameraController?: any;
      GLTFLoader?: any;
      VoxelTileMap?: any;
      TransformControls?: any;
    },
  ) {
    this._container = container;
    this._gameData = gameData;

    const THREE = deps?.THREE ?? RealTHREE;
    const CameraController = deps?.CameraController ?? RealCameraController;
    this._THREE = THREE;
    // ROOT-CAUSE FIX for the single-player "delay": the in-browser server
    // continuously spawns entities (projectiles, AI-attack items, loot, chests)
    // — tens per second in a busy game like Karmaslayers. Every createEntity /
    // mounted-item build constructs a fresh TextureLoader/GLTFLoader and fetches
    // the SAME sprite/model URL from cache.modd.io again. With THREE.Cache
    // disabled (its default), nothing dedupes those fetches, so duplicate
    // requests pile up against the browser's ~6-connections-per-host limit: a
    // projectile only appears once its queued request finally drains ("after a
    // while I can finally see the projectile") and an inventory icon's request,
    // stuck behind the projectile flood, effectively never resolves ("the
    // inventory never updates"). Enabling the cache makes three's ImageLoader /
    // FileLoader serve repeated URLs from memory AND collapse concurrent
    // in-flight requests for the same URL into one fetch — one network request
    // per distinct asset regardless of spawn rate.
    THREE.Cache.enabled = true;
    this._GLTFLoader = deps?.GLTFLoader ?? RealGLTFLoader;
    this._VoxelTileMap = deps?.VoxelTileMap ?? RealVoxelTileMap;
    this._TransformControls = deps?.TransformControls;

    // Create renderer
    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.0;

    const canvas = this._renderer.domElement;
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.zIndex = '1';
    container.appendChild(canvas);

    // Create scene
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x222222);

    // Create camera
    this._camera = new CameraController(cameraConfig);
    this._camera.resize(window.innerWidth, window.innerHeight);
    this._detachControls = this._camera.attachControls(canvas);

    // Resize handler
    window.addEventListener('resize', this._onResize);

    // Lighting from game data
    const lightSettings = gameData.settings?.light as any;
    const ambientIntensity = lightSettings?.ambient?.intensity ?? 1.0;
    const dirIntensity = lightSettings?.directional?.intensity ?? 1.0;
    const dirPos = lightSettings?.directional?.position ?? { x: 1, y: 1, z: 3 };

    this._scene.add(new THREE.AmbientLight(0xffffff, ambientIntensity));
    const dirLight = new THREE.DirectionalLight(0xffffff, dirIntensity);
    dirLight.position.set(dirPos.x ?? 1, dirPos.y ?? 1, dirPos.z ?? 3);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -20;
    dirLight.shadow.camera.right = 20;
    dirLight.shadow.camera.top = 20;
    dirLight.shadow.camera.bottom = -20;
    this._scene.add(dirLight);

    // Skybox
    const skybox = gameData.settings?.skybox as any;
    if (skybox?.front && skybox?.back && skybox?.top && skybox?.bottom && skybox?.left && skybox?.right) {
      new THREE.CubeTextureLoader().load(
        [skybox.right, skybox.left, skybox.top, skybox.bottom, skybox.front, skybox.back],
        (cubeTexture: any) => { this._scene.background = cubeTexture; },
      );
    }

    // Background color
    const bgColor = gameData.settings?.mapBackgroundColor;
    if (bgColor && !skybox?.front) {
      this._scene.background = new THREE.Color(bgColor);
    }

    // Fog — only meaningful for perspective cameras at roughly ground level.
    // Top-down orthographic (pitch ~90°) puts the camera far above the map; map-diagonal-based
    // fog would envelop the entire scene. Skip fog unless the game explicitly enables it.
    const fogSettings = gameData.settings?.fog as any;
    if (fogSettings?.enabled) {
      const near = fogSettings.near ?? 10;
      const far = fogSettings.far ?? 100;
      const color = fogSettings.color ?? 0x87CEEB;
      this._scene.fog = new THREE.Fog(color, near, far);
    }
  }

  get camera(): any { return this._camera; }
  get scene(): any { return this._scene; }

  /** Load and render the tilemap */
  async loadTilemap(): Promise<void> {
    const VoxelTileMap = this._VoxelTileMap;
    if (!VoxelTileMap || !this._gameData.map) return;

    const tileMap = new VoxelTileMap();
    await tileMap.load(this._gameData.map);
    this._scene.add(tileMap.group);
    this._tileMapGroup = tileMap.group;

    // Enable shadow receiving on tilemap
    tileMap.group.traverse((child: any) => {
      if (child.isMesh) child.receiveShadow = true;
    });

    // Center camera on map
    const size = tileMap.getWorldSize(this._gameData.map);
    this._camera.setTarget(size.width / 2, -0.501, size.height / 2);

    // Region preview layer (hidden until the editor's Map tab is entered).
    this._regionLayer = new RegionLayer(this._THREE);
    this._regionLayer.setVisible(false);
    this._scene.add(this._regionLayer.group);

    // TransformControls gizmo for the cursor-mode region interaction.
    // Lives in the scene alongside the regions; binds to a region's fill
    // mesh when the user clicks one. Detached until something is selected.
    // TransformControls is bundled with the engine (packages/engine/engine/client/index.ts).
    const TC = this._TransformControls;
    if (TC) {
      this._regionGizmo = new RegionGizmo(
        TC,
        this._camera.threeCamera,
        this._renderer.domElement,
        this._scene,
        {
          onDragStart: () => {
            // Stash & disable camera controls during drag (legacy: orbit.enabled = !value).
            this._camSavedControls = {
              pannable: (this._camera as any)._pannable,
              zoomable: (this._camera as any)._zoomable,
              pointerLock: (this._camera as any)._pointerLockEnabled,
            };
            this._camera.setControls?.({ pannable: false, zoomable: false, pointerLock: false });
          },
          onDragEnd: (id: string, rect: { x: number; y: number; width: number; height: number }) => {
            if (this._camSavedControls) {
              this._camera.setControls?.(this._camSavedControls);
              this._camSavedControls = null;
            }
            this.onRegionTransformComplete?.(id, rect);
          },
        },
      );
    }
  }

  /** Toggle visibility of all chunks belonging to a tilemap layer. Bridges the
   *  editor's `hide-layer` event (LayerRow eye button) to the rendered scene.
   *  Chunks were named `chunk_${layer.name}_${cx}_${cy}` by VoxelTileMap.load(). */
  setLayerVisible(layerIndex: number, visible: boolean): void {
    if (!this._tileMapGroup) return;
    const layer = this._gameData.map?.layers?.[layerIndex];
    if (!layer?.name) return;
    const prefix = `chunk_${layer.name}_`;
    for (const child of this._tileMapGroup.children) {
      if (typeof child.name === 'string' && child.name.startsWith(prefix)) {
        child.visible = visible;
      }
    }
  }

  /** Start the render loop */
  startRenderLoop(): void {
    this._running = true;
    this._lastTime = performance.now();
    this._renderLoop();
  }

  /** World Y for the top face of the tile layer this entity's body sits on.
   *  Body `z-index.layer` is a 1-based index into `map.layers` — the editor's body modal
   *  stores `layer.index + 1` (see `InputTreeViewComponent.tsx`). `VoxelTileMap` positions
   *  the chunks for the Nth *valid* (tilelayer, has data, not hidden) layer at
   *  `Y = -0.501 + N` with the top face at that same Y. So we walk `map.layers` up to
   *  the original index referenced by z-index.layer and count only the layers that
   *  VoxelTileMap actually rendered. Default 3 matches the legacy body default
   *  (`"z-index":{"layer":3}` in game.json — conventionally "walls" in the
   *  [floor, floor2, walls, trees] template), so units render on top of walls/water
   *  rather than under them. */
  private _entityFloorY(bodyDef: any): number {
    const zIndexLayer = Number(bodyDef?.['z-index']?.layer) || 3;
    const layers = (this._gameData.map?.layers ?? []) as Array<{ type?: string; data?: number[]; visible?: boolean }>;
    const targetOrigIdx = zIndexLayer - 1;
    let filteredIdx = 0;
    for (let i = 0; i < targetOrigIdx && i < layers.length; i++) {
      const lyr = layers[i];
      if (lyr?.type === 'tilelayer' && lyr.data && lyr.visible !== false) filteredIdx++;
    }
    return -0.501 + filteredIdx;
  }

  /** Create a renderable entity from server data */
  createEntity(data: EntityRenderData): void {
    const THREE = this._THREE;
    const cellSheet = data.stats?.cellSheet;
    const url: string | undefined = cellSheet?.url;
    const isGLB = url?.endsWith('.glb') || url?.endsWith('.gltf');
    const isImageSprite = !!url && !isGLB && /\.(png|jpe?g|webp|gif|svg)$/i.test(url);

    const tilePx = this._gameData.map?.tilewidth || 64;
    // Resolve body up-front so the spawn Y can match its `z-index.layer` setting.
    // Items use `bodies.dropped` (and `bodies.selected` when held), not `bodies.default`.
    const bodiesAtSpawn = data.stats?.bodies as Record<string, any> | undefined;
    const spawnBodyDef = bodiesAtSpawn?.default || bodiesAtSpawn?.dropped || bodiesAtSpawn?.selected || data.stats?.body;
    const floorY = this._entityFloorY(spawnBodyDef);

    // Units carry their inventory + selected slot in the spawn payload. Mirror them so that
    // the held-item sprite can be resolved as soon as the unit's mesh finishes loading.
    if (data.classId === 'unit' && data.stats) {
      this._updateUnitInventoryFromStats(data.entityId, data.stats);
    }

    if (isGLB && cellSheet?.url && this._GLTFLoader) {
      this._pendingCreates.add(data.entityId);
      const loader = new this._GLTFLoader();
      loader.load(cellSheet.url, (gltf: any) => {
        // Set.delete returns false when the entry is gone — i.e. destroyEntity already
        // ran for this id while the load was in flight. Bail before touching the scene.
        if (!this._pendingCreates.delete(data.entityId)) return;
        const model = gltf.scene;
        model.position.set(data.x, floorY, data.y);
        (model as any)._spawnFloorY = floorY;
        // Spawn facing the way the export authored it. The sprite branch has always
        // done this; the GLB branch did not, so every model started at yaw 0 and
        // relied entirely on the snapshot lerp to swing it into place — a visible
        // quarter-turn on spawn for map scenery, and permanent for anything the
        // server stops streaming transforms for. Props carry a real angle: the
        // editor writes `rotation.y` in degrees (a chair at 87.9°) and the server
        // broadcasts it as radians on both EntityCreate and every snapshot.
        // GLB models yaw around world Y (see the render loop's `_yawAxis`).
        model.rotation.y = data.rotation || 0;
        model.name = `entity_${data.entityId}`;

        // Scale uniformly from body width. Stash the body-normalized scale on the
        // model so updateEntityStats can multiply by it when stats.scale changes —
        // otherwise the script-driven scale (e.g. celleater's `1 + score/50`) would
        // overwrite the body normalization and every entity would render at its raw
        // gltf size, making cells/viruses/food all look identical.
        // Items keep their collider under `bodies.dropped` (or `bodies.selected` when
        // held), not `bodies.default` — fall back through both.
        const gltfBodies = data.stats?.bodies as Record<string, any> | undefined;
        const bodyDef = gltfBodies?.default || gltfBodies?.dropped || gltfBodies?.selected || data.stats?.body;
        const box = new THREE.Box3().setFromObject(model);
        const modelSize = new THREE.Vector3();
        box.getSize(modelSize);
        const maxDim = Math.max(modelSize.x, modelSize.z);
        let baseScale = 1;
        if (bodyDef && maxDim > 0) {
          // Size the model off the same box the physics collider uses, or it will not
          // agree with what the player can walk into. `GameServer._createEntityBody`
          // resolves, in order: taro-2D `shape.data.halfWidth`, then the 3D editor's
          // unit `shape` × per-axis `scale` (tile units, Z up), then
          // `bodyDef.width/height` (source pixels).
          //
          // Using width/height alone is wrong for a 3D unit, where it holds the SPRITE
          // size: Braains3D's survivor is 1.81×0.52 there but 0.67×0.92 in its fixture.
          // Scaling the GLB to 1.81 tiles drew a model ~2.7× wider than its own
          // collider, so it visibly sank into every wall the collider stopped against.
          const fixture = (bodyDef.fixtures?.[0] ?? {}) as Record<string, any>;
          const sx = Number(fixture.scale?.x);
          const sy = Number(fixture.scale?.y);
          const sz = Number(fixture.scale?.z);
          const has3dBox =
            Number.isFinite(Number(fixture.shape?.width)) && Number.isFinite(Number(fixture.shape?.height)) &&
            Number.isFinite(sx) && Number.isFinite(sy) && (sx !== 1 || sy !== 1);
          const modelTilePx = (this._gameData.map as any)?.tilewidth || 64;

          if (has3dBox && Number.isFinite(sz) && sz > 0 && modelSize.y > 0) {
            // The 3D fixture is a box with Z up, so `shape.depth × scale.z` is the
            // entity's HEIGHT in tiles (the survivor stands 1.88 tall). Match the model's
            // vertical extent to it. Matching the footprint instead would shrink a
            // human-proportioned model to about half height, since its widest horizontal
            // span is much larger than the 0.67×0.92 tile footprint it walks on.
            const heightUnits = Number(fixture.shape?.depth ?? 1) * sz;
            baseScale = heightUnits / modelSize.y;
          } else if (fixture.shape?.data?.halfWidth !== undefined) {
            baseScale = ((Number(fixture.shape.data.halfWidth) * 2) / modelTilePx) / maxDim;
          } else {
            // Width/height are the footprint. Scale by the LARGER of the two: a police
            // car's body is 2.09 × 4.69 tiles, and sizing its longest side to `width`
            // drew a 2.09-long car inside a 4.69-long collider.
            const longest = Math.max(Number(bodyDef.width) || 0, Number(bodyDef.height) || 0) / modelTilePx;
            if (longest > 0 && maxDim > 0) baseScale = longest / maxDim;
          }
        }
        const scriptScale = Number(data.stats?.scale) || 1;
        (model as any)._baseScale = baseScale;
        model.scale.setScalar(baseScale * scriptScale);

        // Shadows
        model.traverse((child: any) => {
          if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
        });

        // Animations
        if (gltf.animations?.length > 0) {
          const mixer = new THREE.AnimationMixer(model);
          const clips = gltf.animations as any[];
          const idleClip = clips.find((c: any) => /idle/i.test(c.name)) || clips[0];
          mixer.clipAction(idleClip).play();
          (model as any)._mixer = mixer;
          (model as any)._clips = clips;
          (model as any)._currentClipName = idleClip.name;
          this._animationMixers.push(mixer);
        }

        // Stash the rendered Y-extent so floating bar/label children can compute
        // their above-the-head offset without re-measuring the (potentially scaled,
        // animated) model later.
        const unitHeight = modelSize.y * baseScale * scriptScale;
        (model as any)._unitHeight = unitHeight;

        // Name label — skip props by default; position above unit's actual rendered height.
        // Only when there is a real name: taro hides the label for ownerless units
        // (the server now streams name='' for them), and a raw entityId is never a
        // valid label — that fallback was what put text over invisible sensor bodies.
        const glbName = typeof data.stats?.name === 'string' ? data.stats.name.trim() : '';
        if (data.classId !== 'prop' && glbName) {
          this._addNameLabel(model, glbName, unitHeight, THREE);
        }

        this._scene.add(model);
        this._entities.set(data.entityId, model);
        // Bars may have arrived before the GLB finished loading (EntityCreate
        // captures attrs synchronously). Attach now that the model exists.
        if (this._entityBars.has(data.entityId)) this._refreshBarSprite(data.entityId);
      },
      undefined,
      (err: any) => {
        // The sprite branch has always reported a failed load; this one swallowed it.
        // A GLB that never resolves leaves the entity out of `_entities` entirely, so
        // it is invisible AND skipped by the render loop's position/rotation lerp —
        // indistinguishable, on screen, from scenery that renders but won't turn.
        this._pendingCreates.delete(data.entityId);
        console.warn('[GameRenderer] GLB load failed:', cellSheet.url, err?.message || err);
      });
    } else if (isImageSprite && url) {
      // Render taro-style PNG sprite as a textured plane lying flat on the ground.
      // Width/height come from body dimensions (in source pixels → divide by the map tile size).
      // Items use `bodies.dropped` (and `bodies.selected` when held); they have no
      // `bodies.default`. Without this, every food/loot rendered at the fallback tile
      // size (1 unit) regardless of its actual collider, making cells/food/viruses
      // visually identical.
      const bodies = data.stats?.bodies as Record<string, any> | undefined;
      const bodyDef = bodies?.default || bodies?.dropped || bodies?.selected || data.stats?.body;
      const mapTilePx = (this._gameData.map as any)?.tilewidth || 64;
      const widthPx = (bodyDef?.width as number) || mapTilePx;
      const heightPx = (bodyDef?.height as number) || mapTilePx;
      const spriteScale = Number(bodyDef?.spriteScale) || 1;
      const wUnits = (widthPx / mapTilePx) * spriteScale;
      const hUnits = (heightPx / mapTilePx) * spriteScale;

      this._pendingCreates.add(data.entityId);
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      loader.load(
        url,
        (texture: any) => {
          // destroyEntity already ran while the texture was loading — bail so the mesh
          // never reaches the scene (otherwise it would persist as a ghost).
          if (!this._pendingCreates.delete(data.entityId)) {
            texture.dispose();
            return;
          }
          texture.magFilter = THREE.NearestFilter;
          texture.minFilter = THREE.NearestFilter;
          texture.colorSpace = THREE.SRGBColorSpace;
          // Spritesheet support: if rowCount/columnCount > 1, use the first cell only.
          // A frame-aware animator can come later.
          const cols = Math.max(1, cellSheet?.columnCount || 1);
          const rows = Math.max(1, cellSheet?.rowCount || 1);
          if (cols > 1 || rows > 1) {
            texture.repeat.set(1 / cols, 1 / rows);
            texture.offset.set(0, 1 - 1 / rows); // top-left cell
          }
          const geo = new THREE.PlaneGeometry(wUnits, hUnits);
          const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide });
          const mesh = new THREE.Mesh(geo, mat);
          // Lay the plane flat on the ground facing up.
          mesh.rotation.x = -Math.PI / 2;
          // Initial facing: taro rotations rotate around the screen normal, which for top-down is world Y.
          // Since the plane was rotated around X, the in-plane "yaw" applies via Z after rotation.
          mesh.rotation.z = data.rotation || 0;
          // Tell the render loop to apply yaw updates to rotation.z (not the default .y),
          // since a plane flattened with rotation.x = −π/2 yaws around its local Z, not Y.
          (mesh as any)._yawAxis = 'z';
          // Sit just above the layer top (per body `z-index.layer`) to avoid z-fighting with tile face.
          mesh.position.set(data.x, floorY + 0.002, data.y);
          (mesh as any)._spawnFloorY = floorY + 0.002;
          mesh.name = `entity_${data.entityId}`;
          // See createEntity (GLB branch) for why we stash this — bar/label
          // overlays use it to position themselves in screen space above the unit.
          (mesh as any)._unitHeight = hUnits;

          // Taro renders name labels above units (player names) and items (drops),
          // but never above projectiles or props — bullets aren't supposed to carry
          // their type name, and a billboarded label is far larger than a 12-pixel
          // collider sprite, completely hiding the bullet.
          // Only when there is a real name: taro hides the label for ownerless
          // units (server streams name='' for them), and a raw entityId is never
          // a valid label — that fallback was what drew text over invisible
          // sensor bodies like "Invisible Body - 64x64".
          const spriteName = typeof data.stats?.name === 'string' ? data.stats.name.trim() : '';
          if (data.classId !== 'prop' && data.classId !== 'projectile' && spriteName) {
            this._addNameLabel(mesh, spriteName, hUnits, THREE);
          }

          this._scene.add(mesh);
          this._entities.set(data.entityId, mesh);
          if (data.classId === 'unit') this._updateHeldItemSprite(data.entityId);
          if (this._entityBars.has(data.entityId)) this._refreshBarSprite(data.entityId);
        },
        undefined,
        (err: any) => {
          this._pendingCreates.delete(data.entityId);
          console.warn('[GameRenderer] sprite load failed:', url, err?.message || err);
        },
      );
    } else {
      // No recognized sprite asset → render as an invisible placeholder. Taro's
      // convention is that entities without a cellSheet.url are invisible (sensor
      // hitboxes, collision-only items, internal "Invisible Body" entities). Track
      // them in _entities so position interpolation and destroyEntity still work,
      // but don't add visible geometry.
      const obj = new THREE.Object3D();
      obj.position.set(data.x, floorY, data.y);
      (obj as any)._spawnFloorY = floorY;
      obj.name = `entity_${data.entityId}`;
      this._scene.add(obj);
      this._entities.set(data.entityId, obj);
      if (this._entityBars.has(data.entityId)) this._refreshBarSprite(data.entityId);
    }
  }

  hasEntity(entityId: string): boolean {
    return this._entities.has(entityId);
  }

  /** Destroy a renderable entity */
  destroyEntity(entityId: string): void {
    // Cancel any in-flight async create for this id (see _pendingCreates).
    this._pendingCreates.delete(entityId);
    const obj = this._entities.get(entityId);
    if (obj) {
      obj.removeFromParent();
      this._entities.delete(entityId);
    }
    this._disposeHeldItemSprite(entityId); // also clears this unit's per-record load tokens
    this._disposeBarSprite(entityId);
    this._unitInventory.delete(entityId);
    this._swingTweens.delete(entityId);
    this._locomotion.forget(entityId);
  }

  /** Set (or clear) the floating attribute bars rendered above the unit's head.
   *  `bars` is the ordered list of bars to draw, top-to-bottom. Pass `[]` to clear.
   *  GameClient computes this list from each unit type's `attributes.<id>.isVisible`
   *  (the `unitBar<Self|Friendly|Neutral|Hostile>` tokens, gated by the viewer's
   *  relationship to that unit's owner). Called every time relevant `attr_*`/
   *  ownership/playerType stats change.
   *
   *  Re-paints the existing canvas + texture when the bar count hasn't changed;
   *  rebuilds the sprite when it has (or when the entity's THREE object hadn't
   *  loaded yet — see createEntity for the catch-up path). */
  setEntityBars(
    entityId: string,
    bars: Array<{ value: number; min: number; max: number; color: string }>,
  ): void {
    if (!bars || bars.length === 0) {
      this._disposeBarSprite(entityId);
      return;
    }
    const existing = this._entityBars.get(entityId);
    if (existing) {
      existing.bars = bars;
    } else {
      this._entityBars.set(entityId, { bars, sprite: null, canvas: null, texture: null });
    }
    this._refreshBarSprite(entityId);
  }

  private _disposeBarSprite(entityId: string): void {
    const e = this._entityBars.get(entityId);
    if (!e) return;
    if (e.sprite) {
      e.sprite.removeFromParent?.();
      e.sprite.material?.dispose?.();
    }
    e.texture?.dispose?.();
    this._entityBars.delete(entityId);
    // Bar gone → label should slide back to its base offset. (No-op when the
    // model is already unloaded — that path is the destroyEntity teardown.)
    const obj = this._entities.get(entityId);
    if (obj) this._positionOverhead(obj);
  }

  /** Build or refresh the canvas + sprite for an entity's bar overlay. Safe to call
   *  before the entity's THREE object exists — it will no-op and createEntity will
   *  invoke it again when the async load resolves. */
  private _refreshBarSprite(entityId: string): void {
    const e = this._entityBars.get(entityId);
    if (!e) return;
    const obj = this._entities.get(entityId);
    if (!obj) return; // entity load still pending; createEntity will re-call us
    const THREE = this._THREE;

    // Per-bar canvas geometry. Numbers chosen to match the name label's pixel
    // density (sprite world scale = canvas px / 80), so the bar visually
    // matches the existing name-label text size at all camera distances.
    const BAR_W_PX = 80;
    const BAR_H_PX = 8;
    const BAR_GAP_PX = 2;
    const PAD_PX = 1;
    const rows = e.bars.length;
    const canvasW = BAR_W_PX + PAD_PX * 2;
    const canvasH = rows * BAR_H_PX + (rows - 1) * BAR_GAP_PX + PAD_PX * 2;

    // Reuse the canvas in place when the row count hasn't changed (HP ticking
    // between hits): only a fillRect repaint, no GPU texture realloc.
    let canvas = e.canvas;
    if (!canvas || canvas.width !== canvasW || canvas.height !== canvasH) {
      canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      e.canvas = canvas;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvasW, canvasH);
    for (let i = 0; i < rows; i++) {
      const bar = e.bars[i];
      const y = PAD_PX + i * (BAR_H_PX + BAR_GAP_PX);
      // Dark backdrop so the bar reads against bright textures/tilesets too.
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(PAD_PX - 1, y - 1, BAR_W_PX + 2, BAR_H_PX + 2);
      ctx.fillStyle = 'rgba(40,40,40,0.95)';
      ctx.fillRect(PAD_PX, y, BAR_W_PX, BAR_H_PX);
      const span = bar.max - bar.min;
      const pct = span > 0 ? Math.max(0, Math.min(1, (bar.value - bar.min) / span)) : 0;
      if (pct > 0) {
        ctx.fillStyle = bar.color || '#ffffff';
        ctx.fillRect(PAD_PX, y, BAR_W_PX * pct, BAR_H_PX);
      }
    }

    // Rebuild texture+sprite only when canvas dimensions changed; otherwise just
    // flag the existing texture dirty so the next render frame uploads the
    // repainted pixels.
    const dimsChanged = !e.sprite || !e.texture
      || (e.sprite.material?.map?.image?.width !== canvasW)
      || (e.sprite.material?.map?.image?.height !== canvasH);
    if (dimsChanged) {
      // Tear down the previous sprite/texture before replacing — happens when
      // the bar count changes (e.g. a new attr becomes visible) so the GPU
      // texture has to be reallocated at the new dimensions.
      if (e.sprite) { e.sprite.removeFromParent?.(); e.sprite.material?.dispose?.(); }
      e.texture?.dispose?.();
      const texture = new THREE.CanvasTexture(canvas);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(canvasW / 80, canvasH / 80, 1);
      obj.add(sprite);
      e.sprite = sprite;
      e.texture = texture;
    } else {
      e.texture.needsUpdate = true;
    }
    // Re-anchor bar + name label every refresh: the bar stack's height enters
    // the label's offset, so toggling a bar in/out has to slide the label too.
    this._positionOverhead(obj);
  }

  /** Mirror inventory/currentSlot from a stats payload into _unitInventory. Returns true if
   *  any inventory-related field was present (so the caller knows to refresh the held sprite). */
  private _updateUnitInventoryFromStats(unitId: string, stats: Record<string, any>): boolean {
    if (stats.inventory === undefined && stats.currentSlot === undefined && stats.currentItemId === undefined) {
      return false;
    }
    const prev = this._unitInventory.get(unitId);
    this._unitInventory.set(unitId, {
      items: stats.inventory !== undefined
        ? (Array.isArray(stats.inventory) ? stats.inventory : [])
        : (prev?.items ?? []),
      currentSlot: stats.currentSlot !== undefined
        ? Number(stats.currentSlot) || 0
        : (prev?.currentSlot ?? 0),
    });
    return true;
  }

  /** Dispose one mounted item sprite (by inventory-record id) or, when `recId` is
   *  omitted, every mounted sprite for the unit. */
  private _disposeHeldItemSprite(unitId: string, recId?: string): void {
    const perUnit = this._heldItemSprites.get(unitId);
    if (!perUnit) return;
    const kill = (rid: string, mesh: any) => {
      mesh.removeFromParent();
      mesh.material?.map?.dispose?.();
      mesh.material?.dispose?.();
      mesh.geometry?.dispose?.();
      perUnit.delete(rid);
      this._heldItemLoadToken.delete(`${unitId}::${rid}`);
    };
    if (recId !== undefined) {
      const m = perUnit.get(recId);
      if (m) kill(recId, m);
      if (perUnit.size === 0) this._heldItemSprites.delete(unitId);
      return;
    }
    for (const [rid, m] of [...perUnit]) kill(rid, m);
    this._heldItemSprites.delete(unitId);
  }

  /** Resolve the body an item should mount in a given state, the taro way: the
   *  state's `body` is a key that's either a direct entry in `bodies` or a state
   *  name. Returns null when the state has no real body (e.g. a weapon's
   *  `states.unselected.body = "none"`) — that's exactly how taro hides a
   *  not-selected weapon while keeping armour (`unselected.body = "selected"`)
   *  on the unit. The `selected`/held path keeps the original fallback chain so
   *  games whose items omit `states` (but do declare `bodies.selected`) still
   *  render the held item; the `unselected` path is strict so a missing/`none`
   *  body correctly means "don't show it". */
  private _resolveStateBody(itemType: Record<string, any>, state: string): { bodyId: string; bodyDef: Record<string, any> } | null {
    const allBodies = itemType.bodies as Record<string, any> | undefined;
    if (!allBodies) return null;
    const bodyId = itemType.states?.[state]?.body as string | undefined;
    if (bodyId && bodyId !== 'none') {
      const bodyDef = allBodies[bodyId];
      if (bodyDef) return { bodyId, bodyDef };
    } else if (state !== 'selected') {
      // unselected with no/`none` body → not shown (weapons).
      return null;
    }
    // Selected/held fallback — preserves pre-existing held-item rendering for
    // item types with absent or dangling `states.selected.body`.
    if (state === 'selected') {
      const fb = allBodies.selected || allBodies.dropped || allBodies.default || (itemType.body as Record<string, any> | undefined);
      if (fb) return { bodyId: 'selected', bodyDef: fb };
    }
    return null;
  }

  /** Reconcile the unit's mounted item sprites against its inventory. Renders one
   *  sprite per inventory item whose current state (`selected` for the held slot,
   *  `unselected` otherwise) resolves to a real body — so armour stays visible on
   *  the head/torso regardless of which slot is selected, while weapons only show
   *  while held. Keyed by record id and diffed, so switching weapon slots never
   *  tears down and reloads the unchanged static armour sprite. */
  private _updateHeldItemSprite(unitId: string): void {
    const unit = this._entities.get(unitId);
    if (!unit) return; // unit not loaded yet — will retry from createEntity callback
    // GLB-rendered units don't have a flat-plane parent; skip until bone attachment is wired up.
    if ((unit as any)._yawAxis !== 'z') return;

    const inv = this._unitInventory.get(unitId);
    const items = inv?.items ?? [];
    const currentSlot = inv?.currentSlot ?? 0;
    const itemTypes = (this._gameData.entities?.itemTypes ?? this._gameData.itemTypes) as Record<string, any> | undefined;

    // Desired: recId -> render descriptor for every inventory item that should
    // currently show a body on the unit.
    const desired = new Map<string, { typeId: string; itemType: Record<string, any>; bodyId: string; bodyDef: Record<string, any>; isSelected: boolean }>();
    items.forEach((rec, slotIdx) => {
      const recId = rec?.id;
      const typeId = rec?.type;
      if (!recId || !typeId) return;
      const itemType = itemTypes?.[typeId] as Record<string, any> | undefined;
      if (!itemType) return;
      const isSelected = slotIdx === currentSlot;
      const resolved = this._resolveStateBody(itemType, isSelected ? 'selected' : 'unselected');
      if (!resolved) return;
      desired.set(recId, { typeId, itemType, bodyId: resolved.bodyId, bodyDef: resolved.bodyDef, isSelected });
    });

    let perUnit = this._heldItemSprites.get(unitId);

    // Tear down sprites for records that left, changed type/body, or flipped
    // selected-state (selected vs unselected can map to different bodies/anchors).
    if (perUnit) {
      for (const [recId, mesh] of [...perUnit]) {
        const d = desired.get(recId);
        if (
          !d ||
          (mesh as any)._typeId !== d.typeId ||
          (mesh as any)._bodyId !== d.bodyId ||
          (mesh as any)._isSelected !== d.isSelected
        ) {
          this._disposeHeldItemSprite(unitId, recId);
        }
      }
      perUnit = this._heldItemSprites.get(unitId);
    }

    // Create sprites that are desired but not yet mounted.
    for (const [recId, d] of desired) {
      if (perUnit?.has(recId)) continue;
      this._buildMountedItemSprite(unitId, recId, d.typeId, d.itemType, d.bodyId, d.bodyDef, d.isSelected);
    }
  }

  /** Build and mount one item sprite (async texture load) for an inventory
   *  record. Anchor / scale / cell-sheet math is unchanged from the original
   *  single-held-item path; the only difference is it's keyed per record and
   *  only the selected item tracks the cursor / swings (armour stays static). */
  private _buildMountedItemSprite(
    unitId: string,
    recId: string,
    typeId: string,
    itemType: Record<string, any>,
    bodyId: string,
    bodyDef: Record<string, any>,
    isSelected: boolean,
  ): void {
    const url: string | undefined = itemType.cellSheet?.url || itemType.inventoryImage;
    if (!url) return;

    const tokenKey = `${unitId}::${recId}`;
    const loadToken = (this._heldItemLoadToken.get(tokenKey) ?? 0) + 1;
    this._heldItemLoadToken.set(tokenKey, loadToken);

    const THREE = this._THREE;
    const tilePx = (this._gameData.map as any)?.tilewidth || 64;
    const widthPx = (bodyDef?.width as number) || 32;
    const heightPx = (bodyDef?.height as number) || 32;
    const spriteScale = Number(bodyDef?.spriteScale) || 1;
    const wUnits = (widthPx / tilePx) * spriteScale;
    const hUnits = (heightPx / tilePx) * spriteScale;
    // Anchors are stored on the resolved body. taro convention: +y_anchor points
    // along the unit's "front" direction. The unit sprite is flattened by R_x(-π/2), which
    // maps the held mesh's local +Y to world -Z — and modu's unit-at-yaw=0 also faces world
    // -Z (per the GameServer rotation comment), so positive uAy already lands in front of the
    // unit without a sign flip. denormalize.ts pre-scales these to px for 3D games.
    const uA = (bodyDef?.unitAnchor as { x?: number; y?: number; rotation?: number } | undefined) || {};
    const iA = (bodyDef?.itemAnchor as { x?: number; y?: number } | undefined) || {};
    const uAx = (Number(uA.x) || 0) / tilePx;
    const uAy = (Number(uA.y) || 0) / tilePx;
    const iAx = (Number(iA.x) || 0) / tilePx;
    const iAy = (Number(iA.y) || 0) / tilePx;
    // `unitAnchor.rotation` is the natural rest tilt of the item relative to the unit's facing.
    // Taro stores it in radians for 3D games (e.g. 1.328125 ≈ 76° for melee weapons in
    // Karmaslayers) — its `getAnchoredOffset` runs `Math.radians()` on the value, which is a
    // degrees-to-radians conversion and silently drops the value to ~1.3° instead of 76°, so
    // taro's chop ends up as a near-cursor-aligned 180° rotation that swings through the back
    // of the body. The 76° tilt is what makes the swing visually look like a left-to-right chop
    // through the front: rest sits 76° off-cursor on one side, swing peak lands 76° on the
    // opposite side, and the 180° arc passes through the cursor direction.
    const uAr = Number((uA as any).rotation) || 0;
    // Only the selected item tracks the cursor / plays use-swings. An unselected
    // armour piece is a static weld on the body even though its item type carries
    // `rotateToFaceMouseCursor` (that flag is for when it's the held weapon).
    const itemFacesCursor = isSelected && !!itemType.controls?.mouseBehaviour?.rotateToFaceMouseCursor;

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      url,
      (texture: any) => {
        // A newer reconcile superseded this record's load while it was in flight
        // (e.g. a stack pickup bumping quantity on the same id). Bail so only the
        // latest load attaches — otherwise this leaks a second untracked sprite.
        if (this._heldItemLoadToken.get(tokenKey) !== loadToken) {
          texture.dispose();
          return;
        }
        // The record may have left the inventory while the texture was loading.
        const curInv = this._unitInventory.get(unitId);
        if (!curInv || !curInv.items.some(i => i?.id === recId)) {
          texture.dispose();
          return;
        }
        // The unit may also have been destroyed during the load.
        const stillUnit = this._entities.get(unitId);
        if (!stillUnit) {
          texture.dispose();
          return;
        }
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;
        const cols = Math.max(1, itemType.cellSheet?.columnCount || 1);
        const rows = Math.max(1, itemType.cellSheet?.rowCount || 1);
        if (cols > 1 || rows > 1) {
          texture.repeat.set(1 / cols, 1 / rows);
          texture.offset.set(0, 1 - 1 / rows);
        }
        const geo = new THREE.PlaneGeometry(wUnits, hUnits);
        const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        // Parent (sprite unit) is rotated -π/2 around X — local +Z maps to world +Y, local +Y
        // maps to world -Z (which is also the unit's facing direction at yaw=0). Position
        // slightly raised on local Z to avoid z-fighting. At item-rot == unit-rot, both anchors
        // live in unit-local space and just sum; the render loop re-rotates the itemAnchor
        // portion when the item faces the cursor independently of the unit.
        // Rest pose: rotate the itemAnchor offset by the rest tilt so the item already sits at
        // its tilted angle when no swing/cursor adjustment is active.
        const _c0 = Math.cos(uAr), _s0 = Math.sin(uAr);
        mesh.position.set(uAx + (iAx * _c0 - iAy * _s0), uAy + (iAx * _s0 + iAy * _c0), 0.002);
        mesh.rotation.z = uAr;
        // Stash anchors + flags for the render loop / reconcile diff.
        (mesh as any)._unitAnchorX = uAx;
        (mesh as any)._unitAnchorY = uAy;
        (mesh as any)._itemAnchorX = iAx;
        (mesh as any)._itemAnchorY = iAy;
        (mesh as any)._unitAnchorRotation = uAr;
        (mesh as any)._facesCursor = itemFacesCursor;
        (mesh as any)._isSelected = isSelected;
        (mesh as any)._typeId = typeId;
        (mesh as any)._bodyId = bodyId;
        (mesh as any)._unitId = unitId;
        stillUnit.add(mesh);
        let perUnit = this._heldItemSprites.get(unitId);
        if (!perUnit) { perUnit = new Map(); this._heldItemSprites.set(unitId, perUnit); }
        perUnit.set(recId, mesh);
      },
      undefined,
      (err: any) => {
        console.warn('[GameRenderer] mounted-item sprite failed:', url, err?.message || err);
      },
    );
  }

  /** Latest cursor world XZ from GameClient's mousemove handler. Read by the render loop
   *  to face held items toward the cursor when the item type has rotateToFaceMouseCursor. */
  setMouseWorldPosition(x: number, z: number): void {
    this._mouseWorldX = x;
    this._mouseWorldZ = z;
  }

  /** Latest cursor world XZ (tile units — same space as entity.position), or null
   *  if the pointer has not moved over the canvas yet. Used by the /dev qtp
   *  quick-teleport key handler. */
  getMouseWorldPosition(): { x: number; z: number } | null {
    if (this._mouseWorldX === null || this._mouseWorldZ === null) return null;
    return { x: this._mouseWorldX, z: this._mouseWorldZ };
  }

  // ---- Region preview / tool API (driven by GameClient bridge) ----------

  upsertRegion(id: string, rect: { x: number; y: number; width: number; height: number }, color?: string, alpha?: number): void {
    this._regionLayer?.upsert(id, { ...rect, color, alpha });
  }
  renameRegion(oldId: string, newId: string): void {
    this._regionLayer?.rename(oldId, newId);
    if (this._selectedRegionId === oldId) this._selectedRegionId = newId;
  }
  deleteRegion(id: string): void {
    if (this._selectedRegionId === id) this.selectRegion(null);
    this._regionLayer?.delete(id);
  }
  getRegion(id: string): { id: string; x: number; y: number; width: number; height: number; color: string; alpha: number } | null {
    return this._regionLayer?.getById(id) ?? null;
  }
  listRegions(): Array<{ id: string }> { return this._regionLayer?.list() ?? []; }
  setRegionsVisible(v: boolean): void { this._regionLayer?.setVisible(v); }
  setRegionToolMode(mode: 'draw' | 'cursor' | null): void {
    this._regionToolMode = mode;
    this._regionDrag = null;
    if (mode === null) this.selectRegion(null);
  }

  /** Select / deselect the region under the gizmo. Attaches/detaches
   *  TransformControls to the region's fill mesh, updates the visible
   *  highlight on RegionLayer, and notifies the bridge so it can toggle the
   *  editor's transform-mode panel. */
  selectRegion(id: string | null): void {
    if (this._selectedRegionId === id) return;
    this._selectedRegionId = id;
    this._regionLayer?.setSelected(id);
    if (id) {
      const mesh = this._regionLayer?.getMesh(id);
      if (mesh && this._regionGizmo) this._regionGizmo.attach(mesh, id);
    } else {
      this._regionGizmo?.detach();
    }
    this.onRegionSelectionChanged?.(id);
  }

  /** Forward editor `gizmo-mode` (translate/scale) to the gizmo. Rotate is
   *  ignored — regions don't rotate (matches legacy `block-rotation: true`). */
  setRegionGizmoMode(mode: GizmoMode | 'rotate'): void {
    if (mode === 'rotate') return;
    this._regionGizmo?.setMode(mode);
  }

  /** Pointer handlers — GameClient raycasts the ground plane and feeds world
   *  XZ here while a region tool mode is active. Returns true if the event was
   *  consumed by region interaction (so GameClient can stop default handling).
   *
   *  Cursor-mode click semantics match legacy taro 3D (Renderer.ts:387-450):
   *  single click on a region selects it (gizmo attaches); a second click on
   *  the same region within 350ms also fires `onRegionDoubleClicked` so the
   *  bridge can open the editor modal. */
  regionPointerDown(wx: number, wz: number): boolean {
    if (!this._regionLayer || !this._regionToolMode) return false;
    if (this._regionToolMode === 'draw') {
      this._regionDrag = { kind: 'draw', sx: wx, sz: wz };
      return true;
    }
    // cursor: defer to TransformControls if it's actively dragging a handle —
    // the gizmo's own pointerdown ran first and we don't want to reselect.
    if (this._regionGizmo?.control?.dragging) return false;
    const hit = this._regionLayer.hitTest(wx, wz);
    if (!hit) {
      this.selectRegion(null);
      this._lastRegionClickAt = 0;
      this._lastRegionClickId = null;
      return false;
    }
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const isDouble = hit === this._lastRegionClickId && (now - this._lastRegionClickAt) < 350;
    this.selectRegion(hit);
    if (isDouble) {
      this.onRegionDoubleClicked?.(hit);
      // Reset so a third quick click doesn't re-trigger.
      this._lastRegionClickAt = 0;
      this._lastRegionClickId = null;
    } else {
      this._lastRegionClickAt = now;
      this._lastRegionClickId = hit;
    }
    return true;
  }

  regionPointerMove(wx: number, wz: number): void {
    const d = this._regionDrag;
    if (!d || !this._regionLayer) return;
    if (d.kind === 'draw') {
      const x = Math.min(d.sx, wx), y = Math.min(d.sz, wz);
      const w = Math.abs(wx - d.sx), h = Math.abs(wz - d.sz);
      this._regionLayer.upsert('__regionDrawPreview__', { x, y, width: w, height: h, color: '#00ff00', alpha: 0.25 });
    }
  }

  regionPointerUp(wx: number, wz: number): void {
    const d = this._regionDrag;
    this._regionDrag = null;
    if (!d || !this._regionLayer) return;
    if (d.kind === 'draw') {
      this._regionLayer.delete('__regionDrawPreview__');
      const x = Math.min(d.sx, wx), y = Math.min(d.sz, wz);
      const w = Math.abs(wx - d.sx), h = Math.abs(wz - d.sz);
      if (w >= 1 && h >= 1) this.onRegionDrawComplete?.({ x, y, width: w, height: h });
    }
  }

  /** Update entity transform targets from server snapshot (interpolated in render loop) */
  updateTransforms(transforms: Array<{ entityId: string; x: number; y: number; height?: number; rotation: number }>): void {
    for (const t of transforms) {
      this._entityTargets.set(t.entityId, { x: t.x, z: t.y, height: t.height ?? 0, ry: t.rotation ?? 0 });
    }
  }

  private _followEntityId: string | null = null;

  /** Set camera to follow an entity (tracks interpolated position each frame) */
  followEntity(entityId: string): void {
    this._followEntityId = entityId;
  }

  /** Currently-followed entity id, or null. */
  getFollowEntityId(): string | null {
    return this._followEntityId;
  }

  /** Stop tracking the followed entity. The render loop won't re-call camera.follow,
   * and the camera's own follow target is cleared so it doesn't tween back to the
   * last position each frame (which would fight `applyPan`). */
  unfollow(): void {
    this._followEntityId = null;
    this._camera?.unfollow?.();
  }

  /** Toggle visibility of all renderable entities (units, items, props). Regions are not in this map. */
  setEntitiesVisible(visible: boolean): void {
    for (const obj of this._entities.values()) {
      obj.visible = visible;
    }
  }

  /**
   * Drive the idle↔walk clip from how fast the server says the entity is moving.
   *
   * The engine has no locomotion animation state at all: `_streamTransforms` sends
   * `{x, z, rotation}` and nothing else, and the only thing that ever changes a clip
   * is an explicit `playAnimation` script action. A GLB unit therefore played its
   * idle clip forever while sliding around the map. Movement is a pure function of
   * the transforms we already receive, so deriving it here keeps the protocol
   * unchanged and works for every unit, local or remote.
   *
   * Speed comes from the authoritative target, not the lerped position — the lerp is
   * asymptotic and never reads as exactly stopped. `LocomotionTracker` owns the
   * measurement window and the start/stop hysteresis; the important part is that it
   * returns `null` on frames with no verdict yet (snapshots arrive at ~20Hz, this
   * runs at ~60Hz) and those frames must leave the playing clip alone. Switching on
   * a per-frame delta instead restarts the run clip from frame 0 whenever a frame
   * lands between two ticks, which is what made a straight-line walk jitter.
   *
   * @param now render-loop clock in seconds
   */
  private _updateLocomotionAnimation(now: number): void {
    for (const [entityId, target] of this._entityTargets) {
      const verdict = this._locomotion.sample(entityId, target.x, target.z, now);

      const obj = this._entities.get(entityId);
      if (!obj || !obj._mixer || !obj._clips) continue;

      const clips = obj._clips as any[];
      const idleClip = clips.find((c: any) => /idle/i.test(c.name));
      const moveClip = clips.find((c: any) => /walk|run|move/i.test(c.name));
      if (!idleClip || !moveClip) continue;

      // A script-driven one-shot (Attack, Jump, death…) owns the model until it
      // returns to a locomotion clip on its own; never stomp it mid-play.
      const current = obj._currentClipName as string | undefined;
      if (current && current !== idleClip.name && current !== moveClip.name) continue;

      // No verdict this frame: hold the current clip. Only a unit that has never
      // been given one falls through, so it can start on idle rather than on
      // whatever the GLB happened to autoplay.
      if (verdict === null && current) continue;

      const isMoving = verdict ?? this._locomotion.isMoving(entityId);
      this.playAnimation(entityId, isMoving ? moveClip.name : idleClip.name);
    }
  }

  /** Switch animation clip for an entity (e.g., idle → walk) */
  playAnimation(entityId: string, animName: string): void {
    const obj = this._entities.get(entityId);
    if (!obj || !obj._mixer || !obj._clips) return;
    if (obj._currentClipName === animName) return;

    const THREE = this._THREE;
    const mixer = obj._mixer as any;
    const clips = obj._clips as any[];

    // Find the target clip (match by name, case-insensitive)
    const clip = clips.find((c: any) => c.name.toLowerCase() === animName.toLowerCase())
      || clips.find((c: any) => c.name.toLowerCase().includes(animName.toLowerCase()));
    if (!clip) return;

    // Crossfade from current to new
    const currentAction = mixer.existingAction(clips.find((c: any) => c.name === obj._currentClipName));
    const newAction = mixer.clipAction(clip);

    if (currentAction) {
      currentAction.fadeOut(0.2);
    }
    newAction.reset().fadeIn(0.2).play();
    obj._currentClipName = clip.name;
  }

  /** Stop an animation clip on an entity */
  stopAnimation(entityId: string, animName: string): void {
    const obj = this._entities.get(entityId);
    if (!obj || !obj._mixer || !obj._clips) return;

    const mixer = obj._mixer as any;
    const clips = obj._clips as any[];
    const clip = clips.find((c: any) => c.name.toLowerCase() === animName.toLowerCase())
      || clips.find((c: any) => c.name.toLowerCase().includes(animName.toLowerCase()));
    if (!clip) return;

    const action = mixer.existingAction(clip);
    if (action) action.fadeOut(0.2);
  }

  /** Update entity stats (animation state, visibility, etc.) */
  updateEntityStats(entityId: string, stats: Record<string, any>): void {
    if (stats.stopAnimation) {
      this.stopAnimation(entityId, stats.stopAnimation);
    }
    if (stats.playAnimation) {
      this.playAnimation(entityId, stats.playAnimation);
    }
    if (stats.currentAnimation) {
      this.playAnimation(entityId, stats.currentAnimation);
    }
    if (stats.useItem) {
      // Server broadcasts the tween *name* (`swingCW`, `swingCCW`, `swing360CW`,
      // `poke`, `recoil`); legacy boolean falls back to swingCW for safety.
      const tweenName = typeof stats.useItem === 'string' ? stats.useItem : 'swingCW';
      this._triggerSwing(entityId, tweenName);
    }

    // Inventory / currentSlot updates → refresh the held-item sprite. This runs *before* the
    // _entities lookup below so the held item still updates even for units that haven't
    // finished loading (the cache is set; the sprite call no-ops until the unit exists).
    if (this._updateUnitInventoryFromStats(entityId, stats)) {
      this._updateHeldItemSprite(entityId);
    }

    const obj = this._entities.get(entityId);
    if (!obj) return;

    if (stats.isHidden !== undefined) {
      obj.visible = !stats.isHidden;
    }
    if (stats.opacity !== undefined) {
      obj.traverse?.((child: any) => {
        if (child.material) {
          child.material.opacity = stats.opacity;
          child.material.transparent = stats.opacity < 1;
        }
      });
    }
    if (stats.scale !== undefined) {
      // stats.scale is the script-side multiplier (e.g. 1 + score/50). Multiply by
      // the body-normalized base saved at creation so the gltf renders at body width
      // first, then grows/shrinks per the script value. Without the multiply, every
      // entity collapses to its raw gltf size scaled by stats.scale and visually
      // identical regardless of body width.
      const baseScale = (obj as any)._baseScale ?? 1;
      obj.scale.setScalar(baseScale * Number(stats.scale));
    }
  }

  /** Start (or restart) a use-tween on the unit's held-item sprite. Timings + peaks
   *  mirror taro's TweenComponent table verbatim. Translation peaks (`poke`, `recoil`)
   *  are taro pixel values, so divide by tilePx to land in the renderer's tile-unit
   *  space (anchors are stored as `px / tilePx` — see `_updateHeldItemSprite`).
   *  Calling again before the prior tween finishes restarts from 0 — matches a
   *  player mashing button1. Unknown names fall through to swingCW so the visual
   *  still cues a "use" action. */
  private _triggerSwing(unitId: string, tweenName: string = 'swingCW'): void {
    if (!this._heldItemSprites.has(unitId)) return;
    const tilePx = (this._gameData.map as any)?.tilewidth || 64;
    let params: { kind: 'rotate' | 'translate'; outMs: number; backMs: number; peak: number };
    switch (tweenName) {
      case 'swingCCW':
        params = { kind: 'rotate', outMs: 100, backMs: 250, peak: -Math.PI };
        break;
      case 'swing360CW':
        params = { kind: 'rotate', outMs: 200, backMs: 200, peak: Math.PI * 2 };
        break;
      case 'poke':
        params = { kind: 'translate', outMs: 60, backMs: 120, peak: 50 / tilePx };
        break;
      case 'recoil':
        params = { kind: 'translate', outMs: 20, backMs: 130, peak: -10 / tilePx };
        break;
      case 'swingCW':
      default:
        params = { kind: 'rotate', outMs: 100, backMs: 250, peak: Math.PI };
        break;
    }
    this._swingTweens.set(unitId, { startTime: performance.now(), ...params });
  }


  /** Set camera to a specific position */
  followPosition(x: number, y: number): void {
    this._camera.follow(x, -0.501, y);
  }

  dispose(): void {
    this._running = false;
    if (this._animFrameId) cancelAnimationFrame(this._animFrameId);
    window.removeEventListener('resize', this._onResize);
    this._detachControls?.();
    for (const id of [...this._heldItemSprites.keys()]) this._disposeHeldItemSprite(id);
    this._heldItemLoadToken.clear();
    this._unitInventory.clear();
    this._swingTweens.clear();
    for (const obj of this._entities.values()) obj.removeFromParent();
    this._entities.clear();
    this._pendingCreates.clear();
    this._renderer.dispose();
    this._renderer.domElement.remove();
  }

  // --- Private ---

  private _renderLoop = (): void => {
    if (!this._running) return;
    const now = performance.now();
    const dt = (now - this._lastTime) / 1000;
    this._lastTime = now;

    // Interpolate entity positions toward targets (smooth movement at 60fps from 20Hz server ticks)
    const lerpSpeed = 15; // Higher = snappier, lower = smoother. 15 gives good feel at 20Hz server.
    const lerpFactor = Math.min(1, dt * lerpSpeed);
    for (const [entityId, target] of this._entityTargets) {
      const obj = this._entities.get(entityId);
      if (!obj) continue;
      obj.position.x += (target.x - obj.position.x) * lerpFactor;
      obj.position.z += (target.z - obj.position.z) * lerpFactor;
      // Height is simulated now, not faked here. `height` is the entity's base above the
      // floor, so it adds to the spawn Y the layer's z-index put the model at — a unit
      // standing on a car is the server telling us so, not a local animation.
      const baseY = (obj as any)._spawnFloorY ?? obj.position.y;
      obj.position.y += (baseY + target.height - obj.position.y) * lerpFactor;
      // Rotation lerp. Sprites flattened with rotation.x = −π/2 yaw around their
      // local Z; GLB models yaw around world Y. Use `while` rather than a single
      // `if` so we fully normalise even after the value has drifted beyond 2π
      // (otherwise the lerp picks the long way round after ~360° of spin).
      const yawAxis: 'y' | 'z' = (obj as any)._yawAxis === 'z' ? 'z' : 'y';
      let angleDiff = target.ry - obj.rotation[yawAxis];
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      obj.rotation[yawAxis] += angleDiff * lerpFactor;
    }

    this._updateLocomotionAnimation(now / 1000);

    // Per-frame held-item pose: combines three sources, all anchored around the
    // unit's hand (unitAnchor) so the held mesh pivots from the grip rather than
    // its center.
    //   1. Cursor-facing (`_facesCursor`): rotation.z = worldYaw − parentYaw, so the held item
    //      faces the cursor regardless of unit yaw. Held mesh is a child of the R_x(−π/2) unit,
    //      so its world yaw = parentYaw + localZ.
    //   2. Rotation tween (`_swingTweens.kind === 'rotate'`): timed rotation 0 → peak → 0,
    //      mirroring taro `swingCW`/`swingCCW`/`swing360CW` from `playEffect('use')`. Stacks
    //      on top of the cursor delta and the `unitAnchor.rotation` rest tilt. The tilt is what
    //      makes the swing look like a left-to-right chop *through* the unit's front: rest sits
    //      ~76° off-cursor on one side, the 180° swing carries the item to the opposite tilt
    //      angle, and the arc passes across the cursor direction. The position recompute
    //      (rotating itemAnchor by the same total rotation) keeps the visual arc and the
    //      mesh rotation in sync.
    //   3. Translation tween (`_swingTweens.kind === 'translate'`): timed translation 0 →
    //      peak → 0 along the item's local +Y axis (after rotation), mirroring taro `poke`
    //      (peak +50) and `recoil` (peak −10). Doesn't change rotation, only position.
    const nowMs = now;
    for (const [unitId, perUnit] of this._heldItemSprites) {
     for (const mesh of perUnit.values()) {
      let cursorDelta = 0;
      const facesCursor = !!(mesh as any)._facesCursor;
      if (facesCursor && this._mouseWorldX !== null && this._mouseWorldZ !== null) {
        const parent = this._entities.get(unitId);
        if (!parent) continue;
        const dx = this._mouseWorldX - parent.position.x;
        const dz = this._mouseWorldZ - parent.position.z;
        const worldYaw = Math.atan2(-dx, -dz);
        const parentYaw = parent.rotation.z || 0;
        cursorDelta = worldYaw - parentYaw;
      }

      let swingOffset = 0;
      let translateOffset = 0;
      // Use-swings only animate the selected/held item; mounted armour is a
      // static weld even while the held weapon swings.
      const swing = (mesh as any)._isSelected ? this._swingTweens.get(unitId) : undefined;
      if (swing) {
        const elapsed = nowMs - swing.startTime;
        let val = 0;
        if (elapsed < swing.outMs) {
          val = swing.peak * (elapsed / swing.outMs);
        } else if (elapsed < swing.outMs + swing.backMs) {
          val = swing.peak * (1 - (elapsed - swing.outMs) / swing.backMs);
        } else {
          this._swingTweens.delete(unitId);
        }
        if (swing.kind === 'rotate') swingOffset = val;
        else translateOffset = val;
      }

      // Static held items at rest (no cursor tracking, no active tween) keep their create-time pose.
      if (!facesCursor && swingOffset === 0 && translateOffset === 0) continue;

      const uAr = ((mesh as any)._unitAnchorRotation as number) || 0;
      // `uAr` (`unitAnchor.rotation`, taro's natural rest tilt for the item — in radians for 3D
      // games) sits *outside* the cursor delta so the item keeps its tilt while tracking the
      // cursor. With the tilt placing rest ~76° off-cursor (e.g. upper-left when cursor is up),
      // the ±π swing peak lands at the opposite tilt (lower-right) and the 180° arc sweeps
      // through the cursor direction (top = unit front) — the left-to-right chop motion through
      // the front. The swingOffset is *added* (not subtracted): taro stores `swingCCW` peak as
      // -π in math-CCW radians and applies the negation in its renderer, so a math-CCW peak
      // corresponds to mesh-rotation-z decreasing, which is the through-the-front direction
      // for an upper-left rest tilt. taro itself effectively drops this tilt via Math.radians()
      // on a radians value, which is why its 180° swing in this game looks like it goes around
      // the body rather than chopping across the front.
      const totalRot = cursorDelta + uAr + swingOffset;
      const cosD = Math.cos(totalRot);
      const sinD = Math.sin(totalRot);
      const uAx = (mesh as any)._unitAnchorX as number;
      const uAy = (mesh as any)._unitAnchorY as number;
      const iAx = (mesh as any)._itemAnchorX as number;
      const iAy = (mesh as any)._itemAnchorY as number;
      const rotIaX = iAx * cosD - iAy * sinD;
      const rotIaY = iAx * sinD + iAy * cosD;
      // Translate along item-local +Y direction (after rotation: (−sin, cos)).
      const tx = translateOffset * -sinD;
      const ty = translateOffset * cosD;
      mesh.position.x = uAx + rotIaX + tx;
      mesh.position.y = uAy + rotIaY + ty;
      mesh.rotation.z = totalRot;
     }
    }

    // Camera follows tracked entity's interpolated position
    if (this._followEntityId) {
      const obj = this._entities.get(this._followEntityId);
      if (obj) {
        this._camera.follow(obj.position.x, -0.501, obj.position.z);
      }
    }

    // Advance skeletal animation. Selecting a clip (spawn idle, `playAnimation`, the
    // locomotion switch above) only weights actions — three.js does not move a single
    // bone until its mixer is stepped, so without this every GLB unit stands frozen on
    // frame 0. This loop sat next to the renderer-side jump arc and was deleted with it
    // when vertical motion moved server-side; it is unrelated to physics.
    for (const mixer of this._animationMixers) {
      mixer.update(dt);
    }

    this._camera.update(dt * 1000);
    this._renderer.render(this._scene, this._camera.threeCamera);
    this._animFrameId = requestAnimationFrame(this._renderLoop);
  };

  private _onResize = (): void => {
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._camera.resize(window.innerWidth, window.innerHeight);
  };

  private _addNameLabel(model: any, name: string, unitHeight: number, THREE: any): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 24px Arial';
    const metrics = ctx.measureText(name);
    canvas.width = Math.ceil(metrics.width) + 8;
    canvas.height = 32;
    ctx.font = 'bold 24px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(name, 4, 24);
    ctx.fillText(name, 4, 24);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(canvas.width / 80, canvas.height / 80, 1);
    model.add(sprite);
    // Stash everything the bar overlay needs to push the label up when bars are
    // present (see _positionOverhead). _baseOffsetY is the default world-units
    // gap between the unit's top and the label's bottom.
    (model as any)._nameLabel = sprite;
    (model as any)._nameLabelHeightWorld = canvas.height / 80;
    (model as any)._nameLabelBaseOffset = 0.2;
    this._positionOverhead(model);
  }

  /** Lay out the unit's overhead-attached sprites (HP-bar stack + name label) in
   *  screen-space: bars sit just above the unit's top edge, name label rides
   *  above the bar stack. Called when the label is first added and again every
   *  time the bar stack's row count changes. */
  private _positionOverhead(model: any): void {
    const unitHeight: number = model._unitHeight ?? 1;
    const isFlat = model._yawAxis === 'z';
    const scale = (isFlat ? 1 : (model.scale?.x || 1));

    // Bar stack height (0 when there are no bars). We look the bar sprite up
    // off the renderer cache rather than the model so a not-yet-attached bar
    // (created before the GLB resolved) still contributes once it lands.
    const barEntry = (() => {
      // model.name === `entity_${entityId}` — strip the prefix to find the bar
      // record.
      const eid = typeof model.name === 'string' ? model.name.replace(/^entity_/, '') : '';
      return eid ? this._entityBars.get(eid) : undefined;
    })();
    const barCanvasH = barEntry?.canvas?.height ?? 0;
    const barHeightWorld = barCanvasH / 80;
    const barGap = barHeightWorld > 0 ? 0.05 : 0;

    // Bars: anchor their bottom edge `0.05` world above the unit's top.
    if (barEntry?.sprite) {
      if (isFlat) {
        const screenUpOffset = unitHeight / 2 + 0.05;
        barEntry.sprite.center.set(0.5, -screenUpOffset / barHeightWorld);
      } else {
        barEntry.sprite.position.y = (unitHeight + 0.05) / scale;
      }
    }

    // Label: rides above the bar stack. When no bars, sits at the original
    // baseOffset above the unit's top (preserves the pre-bars look). When bars
    // are present, packs tight against them — bar at 0.05 above unit, bar
    // height, 0.05 gap, then label.
    const labelSprite = model._nameLabel;
    if (labelSprite) {
      const labelHeightWorld: number = model._nameLabelHeightWorld ?? 0.4;
      const baseOffset: number = model._nameLabelBaseOffset ?? 0.2;
      const labelStartY = barHeightWorld > 0 ? 0.05 + barHeightWorld + barGap : baseOffset;
      if (isFlat) {
        const screenUpOffset = unitHeight / 2 + labelStartY;
        labelSprite.center.set(0.5, -screenUpOffset / labelHeightWorld);
      } else {
        labelSprite.position.y = (unitHeight + labelStartY) / scale;
      }
    }
  }
}
