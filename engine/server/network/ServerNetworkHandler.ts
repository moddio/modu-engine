import { ServerSocket } from './ServerSocket';
import { RateLimiter } from './RateLimiter';
import { InputValidator } from './InputValidator';
import { BandwidthBudget } from './BandwidthBudget';
import { Serializer } from '../../core/network/Serializer';
import { EventEmitter } from '../../core/events/EventEmitter';
import type { NetworkMessage } from '../../core/network/Protocol';

export class ServerNetworkHandler {
  readonly events = new EventEmitter();
  readonly rateLimiter = new RateLimiter();
  readonly bandwidthBudget = new BandwidthBudget();

  constructor(private _socket: ServerSocket) {
    this._socket.events.on('message', (clientId: string, rawData: unknown) => {
      try {
        const buffer = rawData instanceof Buffer ? new Uint8Array(rawData) : rawData as Uint8Array;
        const message = Serializer.decode(buffer) as NetworkMessage;

        if (!this.rateLimiter.check(clientId, String(message.type))) return;

        this.events.emit('message', [clientId, message]);
      } catch {
        // Invalid message, ignore
      }
    });

    this._socket.events.on('connect', (clientId: string) => {
      this.events.emit('connect', clientId);
    });

    this._socket.events.on('disconnect', (clientId: string) => {
      this.events.emit('disconnect', clientId);
    });
  }

  send(clientId: string, message: NetworkMessage): void {
    const encoded = Serializer.encode(message);
    if (this.bandwidthBudget.canSend(clientId, encoded.length)) {
      this.bandwidthBudget.record(clientId, encoded.length);
      this._socket.send(clientId, encoded);
    }
  }

  broadcast(message: NetworkMessage, exclude?: string): void {
    const encoded = Serializer.encode(message);
    this._socket.broadcast(encoded, exclude);
  }
}
