import { Engine } from '../core/Engine';
import { GameMode } from '../core/GameMode';
import { ScriptEngine } from '../core/scripting/ScriptEngine';

export class SinglePlayer {
  readonly engine: Engine;
  readonly mode: GameMode;
  readonly scripts: ScriptEngine;
  private _running = false;

  constructor() {
    this.engine = Engine.instance();
    this.mode = new GameMode('singleplayer');
    this.scripts = new ScriptEngine(this.engine.events);
  }

  get isRunning(): boolean { return this._running; }

  start(): void {
    this._running = true;
  }

  step(dt: number): void {
    if (!this._running) return;
    this.engine.step(dt);
    this.scripts.update(dt);
  }

  loadScript(name: string, code: string): void {
    this.scripts.load(name, code);
  }

  stop(): void {
    this._running = false;
    this.scripts.reset();
  }

  destroy(): void {
    this.stop();
    Engine.reset();
  }
}
