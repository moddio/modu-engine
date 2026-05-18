import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { GameMigrator } from '../../engine/core/GameMigrator';
import { Engine } from '../../engine/core/Engine';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.MODDIO_DATABASE;

describe.skipIf(!URI)('Single-player dev sandbox', () => {
  let server: GameServer;
  let transport: ReturnType<typeof createInMemoryPair>;
  let rawGameData: any;
  let sent: any[];

  beforeEach(async () => {
    Engine.reset();
    if (!rawGameData) {
      const c = new MongoClient(URI!);
      await c.connect();
      const db = c.db('moddio');
      const game = await db.collection('games').findOne({ gameSlug: 'HRP5883Eb' });
      const releases = game!.releases || [];
      const ref = [...releases].reverse().find((r: any) => r.isStable) || releases[releases.length - 1];
      const releaseId = new ObjectId(ref.release.toString());
      const rel =
        (await db.collection('releases').findOne({ _id: releaseId })) ||
        (await db.collection('t3releases').findOne({ _id: releaseId }));
      rawGameData = rel!.data;
      await c.close();
    }
    transport = createInMemoryPair();
  });

  afterEach(() => { server?.stop(); Engine.reset(); });

  async function init(opts?: { singlePlayer?: boolean }) {
    server = new GameServer(transport.server, opts);
    const migrated = GameMigrator.migrate({ data: rawGameData } as any);
    await server.init(migrated as any, rawGameData);
    server.start();
    sent = [];
    transport.client.onMessage((m: any) => sent.push(m));
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Tester', isMobile: false } });
    await new Promise(r => setTimeout(r, 150));
  }

  function firstPlayer() {
    const players = (server as any)._players as Map<string, any>;
    return [...players.entries()][0]; // [clientId, playerData]
  }

  it('defaults the single-player flag to false', async () => {
    await init();
    expect((server as any)._singlePlayer).toBe(false);
  });

  it('sets the single-player flag when constructed with the option', async () => {
    await init({ singlePlayer: true });
    expect((server as any)._singlePlayer).toBe(true);
  });
});
