import type { UIComponent } from './UIManager';
import { EventEmitter } from '../../core/events/EventEmitter';

export type MenuState = 'loading' | 'ready' | 'connecting' | 'playing' | 'disconnected' | 'error';

export interface ServerInfo {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  url: string;
}

export class MenuUI implements UIComponent {
  readonly name = 'menu';
  readonly events = new EventEmitter();
  visible = true;
  private _state: MenuState = 'loading';
  private _errorMessage = '';
  private _servers: ServerInfo[] = [];

  get state(): MenuState { return this._state; }
  get errorMessage(): string { return this._errorMessage; }
  get servers(): ServerInfo[] { return this._servers; }

  setState(state: MenuState, error?: string): void {
    this._state = state;
    if (error) this._errorMessage = error;
    this.events.emit('stateChange', { state, error });
  }

  setServers(servers: ServerInfo[]): void {
    this._servers = servers;
    this.events.emit('serversUpdated', { servers });
  }

  show(): void { this.visible = true; this.events.emit('show'); }
  hide(): void { this.visible = false; this.events.emit('hide'); }
  destroy(): void { this.visible = false; }
}
