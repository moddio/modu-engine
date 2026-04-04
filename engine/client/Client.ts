import { Engine } from '../core/Engine';
import { Renderer } from './renderer/Renderer';
import { Camera } from './renderer/Camera';
import { InputManager } from './input/InputManager';
import { AudioManager } from './audio/AudioManager';
import { EventEmitter } from '../core/events/EventEmitter';

export class Client {
  readonly engine: Engine;
  readonly renderer: Renderer;
  readonly camera: Camera;
  readonly input: InputManager;
  readonly audio: AudioManager;
  readonly events = new EventEmitter();
  private _running = false;
  private _animFrameId = 0;
  private _lastTime = 0;

  constructor() {
    this.engine = Engine.instance();
    this.renderer = new Renderer();
    this.camera = new Camera();
    this.input = new InputManager();
    this.audio = new AudioManager();
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
    this.camera.update();
    this.renderer.render(this.camera.threeCamera, dt);
    this.input.endFrame();

    this._animFrameId = requestAnimationFrame(() => this._loop());
  }
}
