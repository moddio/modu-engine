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
    this._socket.events.on('message', (...args: unknown[]) => {
      const clientId = args[0] as string;
      const rawData = args[1];
      try {
        const buffer = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData as ArrayBufferLike);
        const message = Serializer.decode(buffer) as NetworkMessage;

        if (!this.rateLimiter.check(clientId, String(message.type))) return;

        this.events.emit('message', [clientId, message]);
      } catch {
        // Invalid message, ignore
      }
    });

    this._socket.events.on('connect', (...args: unknown[]) => {
      this.events.emit('connect', args[0] as string);
    });

    this._socket.events.on('disconnect', (...args: unknown[]) => {
      this.events.emit('disconnect', args[0] as string);
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
