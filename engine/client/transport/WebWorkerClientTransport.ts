import type { ClientTransport } from './ClientTransport';
import type { GameMessage } from '../../core/protocol/Messages';

/**
 * Client transport that communicates with a GameServer running in a Web Worker.
 * Uses worker.postMessage to send, worker.onmessage to receive.
 */
export class WebWorkerClientTransport implements ClientTransport {
  private _worker: Worker;
  private _handler: ((message: GameMessage) => void) | null = null;
  private _connected = false;
  private _clientId: string;

  constructor(worker: Worker, clientId: string = 'local_client') {
    this._worker = worker;
    this._clientId = clientId;

    this._worker.addEventListener('message', (e: MessageEvent) => {
      const { clientId, message } = e.data;
      if (clientId === this._clientId || clientId === '__broadcast') {
        this._handler?.(message);
      }
    });
  }

  get connected(): boolean { return this._connected; }
  get clientId(): string { return this._clientId; }

  send(message: GameMessage): void {
    this._worker.postMessage({ clientId: this._clientId, message });
  }

  onMessage(handler: (message: GameMessage) => void): void {
    this._handler = handler;
  }

  async connect(): Promise<void> {
    this._connected = true;
    this._worker.postMessage({
      clientId: this._clientId,
      message: { type: '__connect' },
    });
  }

  disconnect(): void {
    this._connected = false;
    this._worker.postMessage({
      clientId: this._clientId,
      message: { type: '__disconnect' },
    });
  }
}
