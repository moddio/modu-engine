import { ScriptAPI } from './ScriptAPI';

export interface SandboxOptions {
  timeout?: number; // Not enforced in Function() sandbox
}

export class Sandbox {
  private _api: ScriptAPI;

  constructor(api: ScriptAPI, _options?: SandboxOptions) {
    this._api = api;
  }

  execute(code: string): void {
    // Create a function with the script API injected as parameters
    const fn = new Function('on', 'every', code);
    fn(
      this._api.on.bind(this._api),
      this._api.every.bind(this._api),
    );
  }
}
