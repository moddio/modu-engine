import type { ServerTransport } from './ServerTransport';
import type { GameMessage } from '../../core/protocol/Messages';

/**
 * Server transport that runs inside a Web Worker.
 * Uses self.postMessage to send to the main thread,
 * and self.onmessage to receive from it.
 */
export class WebWorkerServerTransport implements ServerTransport {
  private _messageHandlers = new Map<string, (message: GameMessage) => void>();
  private _connectHandler: ((clientId: string) => void) | null = null;
  private _disconnectHandler: ((clientId: string) => void) | null = null;
  private _scope: DedicatedWorkerGlobalScope;

  constructor(scope: DedicatedWorkerGlobalScope) {
    this._scope = scope;
    this._scope.addEventListener('message', (e: MessageEvent) => {
      const { clientId, message } = e.data;
      if (message?.type === '__connect') {
        this._connectHandler?.(clientId);
      } else if (message?.type === '__disconnect') {
        this._disconnectHandler?.(clientId);
      } else if (message && clientId) {
        const handler = this._messageHandlers.get(clientId);
        handler?.(message);
      }
    });
  }

  send(clientId: string, message: GameMessage): void {
    this._scope.postMessage({ clientId, message });
  }

  broadcast(message: GameMessage): void {
    this._scope.postMessage({ clientId: '__broadcast', message });
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
}
