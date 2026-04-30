import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { GameMigrator } from '../../engine/core/GameMigrator';
import { Engine } from '../../engine/core/Engine';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.MODDIO_DATABASE;

describe.skipIf(!URI)('F0mB1BW05 spectator bug repro', () => {
  let server: GameServer;
  let transport: ReturnType<typeof createInMemoryPair>;
  let rawGameData: any;

  beforeEach(async () => {
    Engine.reset();
    if (!rawGameData) {
      const c = new MongoClient(URI!);
      await c.connect();
      const db = c.db('moddio');
      const game = await db.collection('games').findOne({ gameSlug: 'F0mB1BW05' });
      const releaseId = new ObjectId(game!.releases[0].release.toString());
      const release = await db.collection('releases').findOne({ _id: releaseId });
      rawGameData = release!.data;
      await c.close();
    }
    transport = createInMemoryPair();
    server = new GameServer(transport.server);
  });

  afterEach(() => {
    server.stop();
    Engine.reset();
  });

  it('joining player should be assigned to a team during prepare phase, not become observer', async () => {
    const migrated = GameMigrator.migrate({ data: rawGameData } as any);
    await server.init(migrated as any, rawGameData);

    // Inspect state BEFORE start
    console.log('BEFORE start:');
    console.log('  state =', server.scripts.variables.getGlobal('state'));
    console.log('  @statePrepare =', server.scripts.variables.getGlobal('@statePrepare'));

    server.start();

    console.log('AFTER start:');
    console.log('  state =', server.scripts.variables.getGlobal('state'));
    console.log('  @statePrepare =', server.scripts.variables.getGlobal('@statePrepare'));

    // Listen for player:assignType events
    const assignments: Array<[string | undefined, string | undefined]> = [];
    server.engine.events.on('player:assignType', (playerId: unknown, playerType: unknown) => {
      assignments.push([playerId as any, playerType as any]);
      console.log('player:assignType', playerId, playerType);
    });

    transport.client.onMessage(() => {});
    await transport.client.connect();
    // No artificial wait: matches the GameClient.tsx single-player flow where
    // `JoinGame` is sent synchronously on the same call stack as `gameServer.start()`.
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'Tester', isMobile: false } });

    // Allow synchronous handlers to run
    await new Promise((r) => setTimeout(r, 50));

    console.log('Assignments after join:', assignments);
    expect(assignments.length).toBeGreaterThan(0);
    const lastType = assignments[assignments.length - 1][1];
    expect(['purpleTeam', 'redTeam']).toContain(lastType);
  });
});
