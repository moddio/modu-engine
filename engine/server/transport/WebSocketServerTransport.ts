import type { ServerTransport } from './ServerTransport';
import type { GameMessage } from '../../core/protocol/Messages';

/**
 * Server transport using WebSocket (ws library) for production multiplayer.
 * Runs on a real Node.js server. Same interface as WebWorkerServerTransport.
 */
export class WebSocketServerTransport implements ServerTransport {
  private _wss: any; // WebSocket.Server
  private _clients = new Map<string, any>(); // clientId → ws connection
  private _messageHandlers = new Map<string, (message: GameMessage) => void>();
  private _connectHandler: ((clientId: string) => void) | null = null;
  private _disconnectHandler: ((clientId: string) => void) | null = null;
  private _nextClientId = 0;

  constructor(wss: any) {
    this._wss = wss;

    wss.on('connection', (ws: any) => {
      const clientId = `client_${++this._nextClientId}`;
      this._clients.set(clientId, ws);

      // Send client their ID
      ws.send(JSON.stringify({ type: '__clientId', clientId }));

      this._connectHandler?.(clientId);

      ws.on('message', (raw: any) => {
        try {
          const message = JSON.parse(raw.toString()) as GameMessage;
          const handler = this._messageHandlers.get(clientId);
          handler?.(message);
        } catch {
          // Invalid message — ignore
        }
      });

      ws.on('close', () => {
        this._clients.delete(clientId);
        this._messageHandlers.delete(clientId);
        this._disconnectHandler?.(clientId);
      });

      ws.on('error', () => {
        this._clients.delete(clientId);
        this._disconnectHandler?.(clientId);
      });
    });
  }

  send(clientId: string, message: GameMessage): void {
    const ws = this._clients.get(clientId);
    if (ws?.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(message));
    }
  }

  broadcast(message: GameMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this._clients.values()) {
      if (ws.readyState === 1) {
        ws.send(data);
      }
    }
  }

  onMessage(clientId: string, handler: (message: GameMessage) => void): void {
    this._messageHandlers.set(clientId, handler);
  }

  onConnect(handler: (clientId: string) => void): void {
    this._connectHandler = handler;
  }

  onDisconnect(handler: (clientId: string) => void): void {
    this._disconnectHandler = handler;
  }

  get clientCount(): number { return this._clients.size; }
}
