import * as THREE from 'three';

export interface CameraConfig {
  projectionMode?: 'perspective' | 'orthographic';
  fov?: number;
  defaultPitch?: number;   // degrees
  defaultYaw?: number;     // degrees
  zoom?: number;           // distance multiplier
  trackingDelay?: number;  // 0-60, higher = slower follow
  near?: number;
  far?: number;
  collisions?: boolean;
  pitchRange?: { min: number; max: number };  // degrees
  /** Allow mouse-drag camera rotation (pitch/yaw). Defaults to true. */
  rotatable?: boolean;
  /** Allow scroll-wheel zoom. Defaults to true. */
  zoomable?: boolean;
  /** Capture pointer when canvas clicked. Defaults to true iff rotatable. */
  pointerLock?: boolean;
  /** Allow right-mouse-drag camera target panning. Defaults to true. */
  pannable?: boolean;
}

export class CameraController {
  private _perspCamera: THREE.PerspectiveCamera;
  private _orthoCamera: THREE.OrthographicCamera;
  private _projectionMode: 'perspective' | 'orthographic';

  elevation: number;      // radians
  azimuth: number;        // radians
  distance: number;       // zoom level
  trackingDelay: number;  // 0-60

  readonly target = new THREE.Vector3(0, 0, 0);
  readonly position = new THREE.Vector3(0, 10, 0);

  private _fov: number;
  private _near: number;
  private _far: number;
  private _collisions: boolean;
  private _pitchMin: number;
  private _pitchMax: number;
  private _width = 800;
  private _height = 600;
  private _followTarget: THREE.Vector3 | null = null;
  private _rotatable: boolean;
  private _zoomable: boolean;
  private _pointerLockEnabled: boolean;
  private _pannable: boolean;

  constructor(config: CameraConfig = {}) {
    this._projectionMode = config.projectionMode ?? 'orthographic';
    this._fov = config.fov ?? 75;
    this._near = config.near ?? 0.1;
    this._far = config.far ?? 1000;
    this._collisions = config.collisions ?? false;
    this._pitchMin = (config.pitchRange?.min ?? 5) * Math.PI / 180;
    this._pitchMax = (config.pitchRange?.max ?? 90) * Math.PI / 180;

    this.elevation = (config.defaultPitch ?? 90) * Math.PI / 180;
    this.azimuth = (config.defaultYaw ?? 0) * Math.PI / 180;
    this.distance = config.zoom ?? 1;
    this.trackingDelay = config.trackingDelay ?? 0;

    this._rotatable = config.rotatable ?? true;
    this._zoomable = config.zoomable ?? true;
    this._pointerLockEnabled = config.pointerLock ?? this._rotatable;
    this._pannable = config.pannable ?? true;

    this.elevation = Math.max(this._pitchMin, Math.min(this._pitchMax, this.elevation));

    this._perspCamera = new THREE.PerspectiveCamera(this._fov, this._width / this._height, this._near, this._far);
    this._orthoCamera = new THREE.OrthographicCamera(-this._width / 2, this._width / 2, this._height / 2, -this._height / 2, this._near, this._far);

    this._updatePosition();
  }

  get projectionMode(): 'perspective' | 'orthographic' { return this._projectionMode; }

  get threeCamera(): THREE.Camera {
    return this._projectionMode === 'perspective' ? this._perspCamera : this._orthoCamera;
  }

  setProjection(mode: 'perspective' | 'orthographic'): void {
    this._projectionMode = mode;
    this._updateProjection();
  }

  setElevation(degrees: number): void {
    this.elevation = Math.max(this._pitchMin, Math.min(this._pitchMax, degrees * Math.PI / 180));
  }

  setAzimuth(degrees: number): void {
    this.azimuth = degrees * Math.PI / 180;
  }

  setZoom(level: number): void {
    this.distance = Math.max(0.1, level);
  }

  setTarget(x: number, y: number, z: number): void {
    this.target.set(x, y, z);
  }

  follow(x: number, y: number, z: number): void {
    if (!this._followTarget) this._followTarget = new THREE.Vector3();
    this._followTarget.set(x, y, z);
  }

  unfollow(): void {
    this._followTarget = null;
  }

  /** Read-only snapshot of the current follow target, or null if not following. */
  get followTarget(): import('three').Vector3 | null {
    return this._followTarget ? this._followTarget.clone() : null;
  }

  /** Whether pointer lock is active */
  get isPointerLocked(): boolean { return this._pointerLocked; }
  private _pointerLocked = false;
  private _isPanning = false;

  /**
   * Attach pointer lock + scroll zoom controls. Listeners are always attached but
   * their bodies check the live `_rotatable` / `_zoomable` / `_pointerLockEnabled`
   * flags, so callers can toggle at runtime via `setControls(...)` (e.g. editor
   * switching into a Map tab that wants free camera).
   */
  attachControls(canvas: HTMLCanvasElement): () => void {
    const rotateSpeed = 0.0035; // radians per pixel of mouse movement
    const zoomSpeed = 0.5;

    const onClick = () => {
      if (this._pointerLockEnabled && !this._pointerLocked) {
        canvas.requestPointerLock();
      }
    };

    const onPointerLockChange = () => {
      this._pointerLocked = document.pointerLockElement === canvas;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this._pointerLocked || !this._rotatable) return;
      this.azimuth -= e.movementX * rotateSpeed;
      this.elevation = Math.max(this._pitchMin, Math.min(this._pitchMax,
        this.elevation + e.movementY * rotateSpeed));
    };

    const onWheel = (e: WheelEvent) => {
      if (!this._zoomable) return;
      e.preventDefault();
      this.distance = Math.max(0.5, Math.min(30,
        this.distance + (e.deltaY > 0 ? zoomSpeed : -zoomSpeed)));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this._pointerLocked) {
        document.exitPointerLock();
      }
    };

    const onCtx = (e: Event) => e.preventDefault();

    let panLastX = 0;
    let panLastY = 0;

    const onMouseDownPan = (e: MouseEvent) => {
      if (e.button !== 2 || !this._pannable) return;
      e.preventDefault();
      this._isPanning = true;
      panLastX = e.clientX;
      panLastY = e.clientY;
    };

    const onMouseUpPan = (e: MouseEvent) => {
      if (e.button === 2) this._isPanning = false;
    };

    const onMouseMovePan = (e: MouseEvent) => {
      if (!this._isPanning) return;
      const dx = e.clientX - panLastX;
      const dy = e.clientY - panLastY;
      panLastX = e.clientX;
      panLastY = e.clientY;
      this.applyPan(dx, dy);
    };

    canvas.addEventListener('click', onClick);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('contextmenu', onCtx);
    canvas.addEventListener('mousedown', onMouseDownPan);
    window.addEventListener('mouseup', onMouseUpPan);
    document.addEventListener('mousemove', onMouseMovePan);

    return () => {
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('contextmenu', onCtx);
      canvas.removeEventListener('mousedown', onMouseDownPan);
      window.removeEventListener('mouseup', onMouseUpPan);
      document.removeEventListener('mousemove', onMouseMovePan);
      if (this._pointerLocked) document.exitPointerLock();
    };
  }

  /** Enable / disable interactive controls at runtime (e.g. for an editor "Map" tab). */
  setControls(opts: { rotatable?: boolean; zoomable?: boolean; pointerLock?: boolean; pannable?: boolean }): void {
    if (typeof opts.rotatable === 'boolean') this._rotatable = opts.rotatable;
    if (typeof opts.zoomable === 'boolean') this._zoomable = opts.zoomable;
    if (typeof opts.pointerLock === 'boolean') {
      this._pointerLockEnabled = opts.pointerLock;
      if (!this._pointerLockEnabled && this._pointerLocked) {
        document.exitPointerLock();
      }
    }
    if (typeof opts.pannable === 'boolean') {
      this._pannable = opts.pannable;
      if (!this._pannable) this._isPanning = false;
    }
  }

  /**
   * Translate the camera target by a screen-space drag delta in pixels.
   * Pan is azimuth-rotated so the world tracks the cursor, and scaled by
   * the current zoom (`distance`) so feel is consistent at any zoom level.
   * No-op when `pannable` is false.
   */
  applyPan(dx: number, dy: number): void {
    if (!this._pannable) return;
    const PAN_SPEED = 0.01; // world units per pixel at zoom=1
    const scale = PAN_SPEED * this.distance * 3; // matches actualDistance factor in _updatePosition
    const cosAz = Math.cos(this.azimuth);
    const sinAz = Math.sin(this.azimuth);
    // Camera-right in XZ at azimuth=0 is +X; rotating by azimuth gives the screen-right basis.
    // Drag-world-with-cursor convention: cursor right → target moves -right.
    this.target.x -= dx * cosAz * scale + dy * sinAz * scale;
    this.target.z -= -dx * sinAz * scale + dy * cosAz * scale;
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this._perspCamera.aspect = width / height;
    this._perspCamera.updateProjectionMatrix();
    const hw = width / (2 * this.distance);
    const hh = height / (2 * this.distance);
    this._orthoCamera.left = -hw;
    this._orthoCamera.right = hw;
    this._orthoCamera.top = hh;
    this._orthoCamera.bottom = -hh;
    this._orthoCamera.updateProjectionMatrix();
  }

  update(dt: number): void {
    if (this._followTarget) {
      if (this.trackingDelay > 0) {
        const lerpFactor = Math.min(1, dt / (this.trackingDelay * 16.67));
        this.target.lerp(this._followTarget, lerpFactor);
      } else {
        this.target.copy(this._followTarget);
      }
    }

    this._updatePosition();

    const cam = this.threeCamera;
    cam.position.copy(this.position);
    if ('lookAt' in cam) (cam as any).lookAt(this.target);
  }

  private _updatePosition(): void {
    const cosEl = Math.cos(this.elevation);
    const sinEl = Math.sin(this.elevation);
    const cosAz = Math.cos(this.azimuth);
    const sinAz = Math.sin(this.azimuth);

    // Taro zoom maps to camera distance. zoom=1 is close, zoom=3 is medium, zoom=10 is far.
    const actualDistance = this.distance * 3;

    this.position.set(
      this.target.x + actualDistance * cosEl * sinAz,
      this.target.y + actualDistance * sinEl,
      this.target.z + actualDistance * cosEl * cosAz,
    );
  }

  private _updateProjection(): void {
    if (this._projectionMode === 'perspective') {
      this._perspCamera.fov = this._fov;
      this._perspCamera.updateProjectionMatrix();
    } else {
      this.resize(this._width, this._height);
    }
  }
}
