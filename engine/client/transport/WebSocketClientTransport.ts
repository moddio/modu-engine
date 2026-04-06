import type { ClientTransport } from './ClientTransport';
import type { GameMessage } from '../../core/protocol/Messages';

/**
 * Client transport using browser WebSocket for production multiplayer.
 * Connects to a GameServer running on a Node.js server.
 */
export class WebSocketClientTransport implements ClientTransport {
  private _ws: WebSocket | null = null;
  private _url: string;
  private _handler: ((message: GameMessage) => void) | null = null;
  private _connected = false;
  private _clientId: string | null = null;

  constructor(url: string) {
    this._url = url;
  }

  get connected(): boolean { return this._connected; }
  get clientId(): string | null { return this._clientId; }

  send(message: GameMessage): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(message));
    }
  }

  onMessage(handler: (message: GameMessage) => void): void {
    this._handler = handler;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._ws = new WebSocket(this._url);

      this._ws.onopen = () => {
        this._connected = true;
        resolve();
      };

      this._ws.onmessage = (e) => {
        try {
          const message = JSON.parse(e.data) as GameMessage;
          // Intercept client ID assignment
          if ((message as any).type === '__clientId') {
            this._clientId = (message as any).clientId;
            return;
          }
          this._handler?.(message);
        } catch {
          // Invalid message
        }
      };

      this._ws.onclose = () => {
        this._connected = false;
      };

      this._ws.onerror = () => {
        this._connected = false;
        reject(new Error('WebSocket connection failed'));
      };
    });
  }

  disconnect(): void {
    this._connected = false;
    this._ws?.close();
    this._ws = null;
  }
}
