import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityStreamManager, StreamEntityData } from '../../../engine/server/network/EntityStreamManager';

function makeMockSocket() {
  return {
    send: vi.fn(),
    broadcast: vi.fn(),
    disconnect: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
    get clientCount() { return 0; },
    start: vi.fn(),
    stop: vi.fn(),
  } as any;
}

function makeEntity(id: string): StreamEntityData {
  return { id, category: 'unit', x: 10, y: 20, angle: 0.5 };
}

describe('EntityStreamManager', () => {
  let socket: ReturnType<typeof makeMockSocket>;
  let manager: EntityStreamManager;

  beforeEach(() => {
    socket = makeMockSocket();
    manager = new EntityStreamManager(socket);
  });

  it('addClient / removeClient updates client count', () => {
    manager.addClient('c1');
    manager.addClient('c2');
    expect(manager.clientCount).toBe(2);
    manager.removeClient('c1');
    expect(manager.clientCount).toBe(1);
  });

  it('streamCreate adds entity to tracked set and sends message', () => {
    manager.addClient('c1');
    const entity = makeEntity('e1');
    manager.streamCreate('c1', entity);

    expect(manager.getClientEntities('c1').has('e1')).toBe(true);
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send.mock.calls[0][0]).toBe('c1');
  });

  it('streamCreate is no-op for unknown client', () => {
    manager.streamCreate('unknown', makeEntity('e1'));
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('streamDestroy removes from tracked set and sends message', () => {
    manager.addClient('c1');
    manager.streamCreate('c1', makeEntity('e1'));
    manager.streamDestroy('c1', 'e1');

    expect(manager.getClientEntities('c1').has('e1')).toBe(false);
    expect(socket.send).toHaveBeenCalledTimes(2); // create + destroy
  });

  it('streamDestroy is no-op for unknown client', () => {
    manager.streamDestroy('unknown', 'e1');
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('getClientEntities returns correct set', () => {
    manager.addClient('c1');
    manager.streamCreate('c1', makeEntity('e1'));
    manager.streamCreate('c1', makeEntity('e2'));
    const tracked = manager.getClientEntities('c1');
    expect(tracked.size).toBe(2);
    expect(tracked.has('e1')).toBe(true);
    expect(tracked.has('e2')).toBe(true);
  });

  it('getClientEntities returns empty set for unknown client', () => {
    const tracked = manager.getClientEntities('unknown');
    expect(tracked.size).toBe(0);
  });

  it('streamAllToClient adds all entities', () => {
    manager.addClient('c1');
    const entities = [makeEntity('e1'), makeEntity('e2'), makeEntity('e3')];
    manager.streamAllToClient('c1', entities);

    const tracked = manager.getClientEntities('c1');
    expect(tracked.size).toBe(3);
    expect(socket.send).toHaveBeenCalledTimes(3);
  });

  it('streamTransform sends to clients tracking the entity', () => {
    manager.addClient('c1');
    manager.addClient('c2');
    manager.streamCreate('c1', makeEntity('e1'));
    // c2 does NOT track e1

    socket.send.mockClear();
    manager.streamTransform(makeEntity('e1'), 42);

    // Only c1 should receive the transform
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send.mock.calls[0][0]).toBe('c1');
  });

  it('streamTransform sends to multiple clients tracking same entity', () => {
    manager.addClient('c1');
    manager.addClient('c2');
    manager.streamCreate('c1', makeEntity('e1'));
    manager.streamCreate('c2', makeEntity('e1'));

    socket.send.mockClear();
    manager.streamTransform(makeEntity('e1'), 10);
    expect(socket.send).toHaveBeenCalledTimes(2);
  });
});
