import { describe, it, expect, vi } from 'vitest';
import { createInMemoryPair } from '../../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../../engine/core/protocol/Messages';

describe('Transport', () => {
  it('client sends message, server receives it', () => {
    const { server, client } = createInMemoryPair();
    const handler = vi.fn();
    server.onMessage('client1', handler);

    client.send({ type: MessageType.JoinGame, data: { playerName: 'test' } });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.JoinGame })
    );
  });

  it('server sends to client, client receives it', () => {
    const { server, client } = createInMemoryPair();
    const handler = vi.fn();
    client.onMessage(handler);

    server.send('client1', { type: MessageType.EntityCreate, data: {} });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.EntityCreate })
    );
  });

  it('server broadcasts to all clients', () => {
    const { server, client } = createInMemoryPair();
    const handler = vi.fn();
    client.onMessage(handler);

    server.broadcast({ type: MessageType.Snapshot, data: {} });

    expect(handler).toHaveBeenCalled();
  });

  it('connect/disconnect fire handlers', async () => {
    const { server, client } = createInMemoryPair();
    const connectHandler = vi.fn();
    const disconnectHandler = vi.fn();
    server.onConnect(connectHandler);
    server.onDisconnect(disconnectHandler);

    await client.connect();
    expect(connectHandler).toHaveBeenCalledWith('client1');
    expect(client.connected).toBe(true);

    client.disconnect();
    expect(disconnectHandler).toHaveBeenCalledWith('client1');
    expect(client.connected).toBe(false);
  });
});
