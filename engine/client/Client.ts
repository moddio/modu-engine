import { Engine } from '../core/Engine';
import { Renderer } from './renderer/Renderer';
import { CameraController, CameraConfig } from './renderer/CameraController';
import { InputManager } from './input/InputManager';
import { AudioManager } from './audio/AudioManager';
import { AssetManager } from './renderer/AssetManager';
import { EventEmitter } from '../core/events/EventEmitter';

export class Client {
  readonly engine: Engine;
  readonly renderer: Renderer;
  readonly camera: CameraController;
  readonly input: InputManager;
  readonly audio: AudioManager;
  readonly assets: AssetManager;
  readonly events = new EventEmitter();
  private _running = false;
  private _animFrameId = 0;
  private _lastTime = 0;

  constructor(cameraConfig?: CameraConfig) {
    this.engine = Engine.instance();
    this.renderer = new Renderer();
    this.camera = new CameraController(cameraConfig);
    this.input = new InputManager();
    this.audio = new AudioManager();
    this.assets = new AssetManager();
  }

  start(): void {
    this._running = true;
    this._lastTime = performance.now();
    this._loop();
  }

  stop(): void {
    this._running = false;
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
    }
  }

  private _loop(): void {
    if (!this._running) return;
    const now = performance.now();
    const dt = now - this._lastTime;
    this._lastTime = now;

    this.engine.step(dt);
    this.camera.update(dt);
    this.renderer.render(this.camera.threeCamera, dt);
    this.input.endFrame();

    this._animFrameId = requestAnimationFrame(() => this._loop());
  }
}
