import { createRequire } from 'node:module';
const require = createRequire('/app/data/home/moddio-sdk/');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
import { GameServer } from '../engine/server/GameServer';
import { GameMigrator } from '../engine/core/GameMigrator';
import { createInMemoryPair } from '../engine/core/transport/InMemoryTransport';
import { MessageType } from '../engine/core/protocol/Messages';
import { Engine } from '../engine/core/Engine';

dotenv.config({ path: '/app/data/home/moddio-sdk/packages/web/.env' });

const c = new MongoClient(process.env.MODDIO_DATABASE!);
await c.connect();
const g = await c.db().collection('games').findOne({ gameSlug: 'HRP5883Eb' });
const rel = g!.releases[g!.releases.length - 1];
const r = await c.db().collection('releases').findOne({ _id: rel.release });
const gameData = (r as any).data;
await c.close();

Engine.reset();
const transport = createInMemoryPair();
const server = new GameServer(transport.server);
const migrated = GameMigrator.migrate({ data: gameData } as any);
await server.init(migrated as any, gameData);
server.start();

let projCreates = 0;
transport.client.onMessage((msg: any) => {
  if (msg.type === MessageType.EntityCreate && msg.data?.category === 'projectile') projCreates++;
});
await transport.client.connect();
transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P', isMobile: false } });

const tick = (dt: number) => (server as any)._tick(dt);
for (let i = 0; i < 10; i++) tick(50); // let unit + inventory settle

const unit = [...(server as any)._entities.values()].find((e: any) => e.category === 'unit');
console.log('unit?', !!unit, 'type', unit?.stats?.type, 'currentItemId', unit?.stats?.currentItemId);
const inv = unit?.stats?.inventory ?? [];
console.log('inventory', JSON.stringify(inv.map((s: any) => s && { id: s.id, type: s.type })));
const heldType = inv.find((s: any) => s?.id === unit?.stats?.currentItemId)?.type;
const it = (migrated as any).entities?.itemTypes?.[heldType] ?? (gameData.itemTypes?.[heldType]);
console.log('held itemType', heldType, 'isGun', it?.isGun, 'projectileType', it?.projectileType, 'fireRate', it?.fireRate);

const before = projCreates;
// Simulate 8 rapid LMB clicks: keyDown+keyUp 'button1', 10ms apart — all within
// one fireRate window for any sane weapon.
for (let i = 0; i < 8; i++) {
  transport.client.send({ type: MessageType.PlayerKeyDown, data: { device: 'mouse', key: 'button1' } });
  transport.client.send({ type: MessageType.PlayerKeyUp, data: { device: 'mouse', key: 'button1' } });
  tick(10);
}
const rapidShots = projCreates - before;
console.log(`RAPID 8 clicks within ~80ms -> projectiles spawned: ${rapidShots}`);

server.stop();
Engine.reset();
process.exit(0);
