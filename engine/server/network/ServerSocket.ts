import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from '../../core/events/EventEmitter';

export class ServerSocket {
  private _wss: WebSocketServer | null = null;
  readonly events = new EventEmitter();
  private _clients = new Map<string, WebSocket>();
  private _nextId = 0;

  start(port: number): void {
    this._wss = new WebSocketServer({ port });

    this._wss.on('connection', (ws) => {
      const clientId = `client_${++this._nextId}`;
      this._clients.set(clientId, ws);
      this.events.emit('connect', clientId);

      ws.on('message', (data) => {
        this.events.emit('message', [clientId, data]);
      });

      ws.on('close', () => {
        this._clients.delete(clientId);
        this.events.emit('disconnect', clientId);
      });
    });
  }

  send(clientId: string, data: Uint8Array): void {
    this._clients.get(clientId)?.send(data);
  }

  broadcast(data: Uint8Array, exclude?: string): void {
    for (const [id, ws] of this._clients) {
      if (id !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  disconnect(clientId: string): void {
    this._clients.get(clientId)?.close();
    this._clients.delete(clientId);
  }

  get clientCount(): number { return this._clients.size; }

  stop(): void {
    this._wss?.close();
    this._clients.clear();
  }
}
