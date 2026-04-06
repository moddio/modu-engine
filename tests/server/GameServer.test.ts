import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { Engine } from '../../engine/core/Engine';

const TEST_GAME_DATA = {
  version: '2.0',
  settings: { frameRate: 20 },
  map: { width: 10, height: 10, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] },
  entities: {
    unitTypes: {
      'soldier': {
        name: 'Soldier',
        body: { type: 'dynamic', width: 40, height: 40, linearDamping: 5 },
        bodies: { default: { width: 1, height: 1, depth: 1 } },
        attributes: { health: { value: 100, max: 100 }, speed: { value: 40 } },
        controls: { movementMethod: 'velocity', movementType: 'wasd' },
      },
    },
    itemTypes: {},
    projectileTypes: {},
    playerTypes: {},
  },
  scripts: {
    'onStart': { name: 'On Start', triggers: ['gameStart'], actions: [
      { type: 'setVariable', variableName: 'gameRunning', value: true },
    ]},
  },
  variables: { gameRunning: { value: false, type: 'boolean' } },
};

describe('GameServer', () => {
  let server: GameServer;
  let transport: ReturnType<typeof createInMemoryPair>;

  beforeEach(() => {
    Engine.reset();
    transport = createInMemoryPair();
    server = new GameServer(transport.server);
  });

  afterEach(() => {
    server.stop();
    Engine.reset();
  });

  it('initializes from game data', () => {
    server.init(TEST_GAME_DATA as any);
    expect(server.isRunning).toBe(false);
    expect(server.entityCount).toBe(0);
  });

  it('starts the tick loop and fires gameStart', () => {
    server.init(TEST_GAME_DATA as any);
    server.start();
    expect(server.isRunning).toBe(true);
    expect(server.scripts.variables.getGlobal('gameRunning')).toBe(true);
  });

  it('creates a player on joinGame', async () => {
    server.init(TEST_GAME_DATA as any);
    server.start();

    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Test', isMobile: false } });

    expect(server.playerCount).toBe(1);
  });

  it('streams entity create to client on join', async () => {
    server.init(TEST_GAME_DATA as any);
    server.start();

    const messages: any[] = [];
    transport.client.onMessage((msg) => messages.push(msg));
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Test', isMobile: false } });

    const createMsgs = messages.filter(m => m.type === MessageType.EntityCreate);
    expect(createMsgs.length).toBeGreaterThan(0);
    expect(createMsgs[0].data.classId).toBe('unit');
  });

  it('responds to ping with pong', async () => {
    server.init(TEST_GAME_DATA as any);
    server.start();

    const messages: any[] = [];
    transport.client.onMessage((msg) => messages.push(msg));
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Test', isMobile: false } });
    transport.client.send({ type: MessageType.Ping, data: { sentAt: Date.now() } });

    const pongs = messages.filter(m => m.type === MessageType.Pong);
    expect(pongs.length).toBe(1);
  });

  it('stops cleanly', () => {
    server.init(TEST_GAME_DATA as any);
    server.start();
    server.stop();
    expect(server.isRunning).toBe(false);
    expect(server.entityCount).toBe(0);
  });
});
