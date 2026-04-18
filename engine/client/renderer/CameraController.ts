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

  /** Whether pointer lock is active */
  get isPointerLocked(): boolean { return this._pointerLocked; }
  private _pointerLocked = false;

  /** Attach pointer lock + scroll zoom controls. Returns cleanup function. */
  attachControls(canvas: HTMLCanvasElement): () => void {
    const rotateSpeed = 0.0035; // radians per pixel of mouse movement
    const zoomSpeed = 0.5;

    const onPointerDown = () => {
      if (this._pointerLocked) return;
      canvas.requestPointerLock();
    };

    const onPointerLockChange = () => {
      this._pointerLocked = document.pointerLockElement === canvas;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this._pointerLocked) return;
      this.azimuth -= e.movementX * rotateSpeed;
      // Mouse up (negative movementY) → decrease elevation (look down toward ground)
      // This matches taro engine behavior where mouse controls camera orbit, not FPS look
      this.elevation = Math.max(this._pitchMin, Math.min(this._pitchMax,
        this.elevation + e.movementY * rotateSpeed));
    };

    const onWheel = (e: WheelEvent) => {
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

    // Listen on the canvas itself so only direct clicks on it trigger pointer lock.
    // Overlays (editor, menus, HUD) sit above the canvas in the DOM and will
    // naturally intercept clicks without triggering lock.
    canvas.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('contextmenu', onCtx);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('contextmenu', onCtx);
      if (this._pointerLocked) document.exitPointerLock();
    };
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
