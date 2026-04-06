import type { ServerTransport } from '../../server/transport/ServerTransport';
import type { ClientTransport } from '../../client/transport/ClientTransport';
import type { GameMessage } from '../protocol/Messages';

export class InMemoryServerTransport implements ServerTransport {
  private _messageHandlers = new Map<string, (message: GameMessage) => void>();
  private _connectHandler: ((clientId: string) => void) | null = null;
  private _disconnectHandler: ((clientId: string) => void) | null = null;
  _clientTransport: InMemoryClientTransport | null = null;

  send(clientId: string, message: GameMessage): void {
    this._clientTransport?._receive(message);
  }

  broadcast(message: GameMessage): void {
    this._clientTransport?._receive(message);
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

  _receiveFromClient(clientId: string, message: GameMessage): void {
    const handler = this._messageHandlers.get(clientId);
    if (handler) handler(message);
  }

  simulateConnect(clientId: string): void {
    this._connectHandler?.(clientId);
  }

  simulateDisconnect(clientId: string): void {
    this._disconnectHandler?.(clientId);
  }
}

export class InMemoryClientTransport implements ClientTransport {
  private _handler: ((message: GameMessage) => void) | null = null;
  private _connected = false;
  private _clientId: string;
  _serverTransport: InMemoryServerTransport | null = null;

  constructor(clientId: string = 'client1') {
    this._clientId = clientId;
  }

  get connected(): boolean { return this._connected; }

  send(message: GameMessage): void {
    this._serverTransport?._receiveFromClient(this._clientId, message);
  }

  onMessage(handler: (message: GameMessage) => void): void {
    this._handler = handler;
  }

  async connect(): Promise<void> {
    this._connected = true;
    this._serverTransport?.simulateConnect(this._clientId);
  }

  disconnect(): void {
    this._connected = false;
    this._serverTransport?.simulateDisconnect(this._clientId);
  }

  _receive(message: GameMessage): void {
    this._handler?.(message);
  }
}

export function createInMemoryPair(clientId: string = 'client1'): { server: InMemoryServerTransport; client: InMemoryClientTransport } {
  const server = new InMemoryServerTransport();
  const client = new InMemoryClientTransport(clientId);
  server._clientTransport = client;
  client._serverTransport = server;
  return { server, client };
}
