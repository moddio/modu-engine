import { EventEmitter } from '../events/EventEmitter';
import { ScriptAPI } from './ScriptAPI';
import { Sandbox } from './Sandbox';

export class ScriptEngine {
  readonly api: ScriptAPI;
  readonly events: EventEmitter;
  private _sandbox: Sandbox;
  private _scripts: Map<string, string> = new Map();

  constructor(events?: EventEmitter) {
    this.events = events ?? new EventEmitter();
    this.api = new ScriptAPI(this.events);
    this._sandbox = new Sandbox(this.api);
  }

  load(name: string, code: string): void {
    this._scripts.set(name, code);
    this._sandbox.execute(code);
  }

  unload(name: string): void {
    this._scripts.delete(name);
  }

  get scriptCount(): number {
    return this._scripts.size;
  }

  update(dt: number): void {
    this.api.update(dt);
  }

  reset(): void {
    this._scripts.clear();
    this.api.reset();
  }
}
