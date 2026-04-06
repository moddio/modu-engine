import type { GameMessage } from '../../core/protocol/Messages';

export interface ServerTransport {
  send(clientId: string, message: GameMessage): void;
  broadcast(message: GameMessage): void;
  onMessage(clientId: string, handler: (message: GameMessage) => void): void;
  onConnect(handler: (clientId: string) => void): void;
  onDisconnect(handler: (clientId: string) => void): void;
}
