import type { GameMessage } from '../../core/protocol/Messages';

export interface ClientTransport {
  send(message: GameMessage): void;
  onMessage(handler: (message: GameMessage) => void): void;
  connect(): Promise<void>;
  disconnect(): void;
  readonly connected: boolean;
}
