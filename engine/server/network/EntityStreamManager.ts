import type { ServerSocket } from './ServerSocket';
import { MessageType } from '../../core/network/Protocol';
import { Serializer } from '../../core/network/Serializer';

export interface StreamEntityData {
  id: string;
  category: string;
  x: number;
  y: number;
  angle: number;
  stats?: Record<string, unknown>;
}

export class EntityStreamManager {
  private _socket: ServerSocket;
  /** Track which entities each client currently sees */
  private _clientEntities = new Map<string, Set<string>>();

  constructor(socket: ServerSocket) {
    this._socket = socket;
  }

  /** Register a new client */
  addClient(clientId: string): void {
    this._clientEntities.set(clientId, new Set());
  }

  /** Remove a client */
  removeClient(clientId: string): void {
    this._clientEntities.delete(clientId);
  }

  /** Stream entity creation to a client */
  streamCreate(clientId: string, entity: StreamEntityData): void {
    const tracked = this._clientEntities.get(clientId);
    if (!tracked) return;
    tracked.add(entity.id);
    this._socket.send(clientId, Serializer.encode({
      type: MessageType.EntityCreate,
      tick: 0,
      data: entity,
    }));
  }

  /** Stream entity destruction to a client */
  streamDestroy(clientId: string, entityId: string): void {
    const tracked = this._clientEntities.get(clientId);
    if (!tracked) return;
    tracked.delete(entityId);
    this._socket.send(clientId, Serializer.encode({
      type: MessageType.EntityDestroy,
      tick: 0,
      data: { id: entityId },
    }));
  }

  /** Broadcast entity transform update to all clients tracking it */
  streamTransform(entity: StreamEntityData, tick: number): void {
    const msg = Serializer.encode({
      type: MessageType.DeltaUpdate,
      tick,
      data: { id: entity.id, x: entity.x, y: entity.y, angle: entity.angle },
    });
    for (const [clientId, entities] of this._clientEntities) {
      if (entities.has(entity.id)) {
        this._socket.send(clientId, msg);
      }
    }
  }

  /** Stream all existing entities to a newly connected client */
  streamAllToClient(clientId: string, entities: StreamEntityData[]): void {
    for (const entity of entities) {
      this.streamCreate(clientId, entity);
    }
  }

  /** Get entity IDs tracked by a client */
  getClientEntities(clientId: string): Set<string> {
    return this._clientEntities.get(clientId) ?? new Set();
  }

  get clientCount(): number { return this._clientEntities.size; }
}
