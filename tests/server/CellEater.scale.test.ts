import { describe, it, expect } from 'vitest';
import { GameServer } from '../../engine/server/GameServer';
import { createInMemoryPair } from '../../engine/core/transport/InMemoryTransport';
import { MessageType } from '../../engine/core/protocol/Messages';
import { Engine } from '../../engine/core/Engine';

// Minimal celleater-shaped fixture: a humanPlayer playerType with a Score attribute
// (cap4wtDrqa), a Cell unitType, and the two scripts that drive the size update —
// (1) a `playerJoinsGame` script that assigns the playerType + runs the size script,
// (2) the size script itself that scales each cell from getPlayerAttribute('cap4wtDrqa').
const SCORE_ATTR = 'cap4wtDrqa';
const CELL_TYPE = 'axSpuTp3mh';
const HUMAN_PT = 'humanPlayer';
const SIZE_SCRIPT = 'updateCellStats';
const VIRUS_RESCALE_SCRIPT = 'virusRescale';
const VIRUS_PT = 'virusOwner';
const VIRUS_TYPE = 'virusUnit';

const FIXTURE: any = {
  version: '2.0',
  settings: { frameRate: 20 },
  map: { width: 10, height: 10, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] },
  entities: {
    unitTypes: {
      [CELL_TYPE]: {
        name: 'Cell',
        body: { type: 'dynamic', width: 16, height: 16, linearDamping: 5 },
        bodies: { default: { width: 1, height: 1, depth: 1 } },
        attributes: { speed: { value: 5, max: 50 } },
        controls: { movementMethod: 'velocity', movementType: 'wasd' },
      },
      [VIRUS_TYPE]: {
        name: 'Virus',
        body: { type: 'static', width: 16, height: 16 },
        bodies: { default: { width: 1, height: 1, depth: 1 } },
        attributes: {},
        controls: {},
      },
    },
    itemTypes: {},
    projectileTypes: {},
    playerTypes: {
      [HUMAN_PT]: {
        name: 'Cells',
        attributes: { [SCORE_ATTR]: { name: 'Score', value: 10, min: 10, max: 1000000 } },
      },
      [VIRUS_PT]: { name: 'Green Viruses', attributes: {} },
    },
  },
  scripts: {
    playerJoinsGame: {
      name: 'set up joining players',
      triggers: [{ type: 'playerJoinsGame' }],
      conditions: [],
      actions: [
        {
          type: 'createUnitAtPosition',
          unitType: CELL_TYPE,
          entity: { function: 'getTriggeringPlayer' },
          position: { x: 5, y: 5 },
          angle: 0,
        },
        // Mirrors taro game-data shape: the player slot is named `entity`, not `player`.
        { type: 'assignPlayerType', playerType: HUMAN_PT, entity: { function: 'getTriggeringPlayer' } },
        { type: 'playerCameraTrackUnit', player: { function: 'getTriggeringPlayer' }, unit: { function: 'getLastCreatedUnit' } },
        { type: 'setVariable', variableName: 'unit', value: { function: 'getLastCreatedUnit' } },
        { type: 'runScript', scriptName: SIZE_SCRIPT },
      ],
    },
    [SIZE_SCRIPT]: {
      name: 'update cell stats',
      triggers: [],
      conditions: [{ operator: '==', operandType: 'boolean' }, true, true],
      actions: [
        {
          type: 'changeScaleOfEntitySprite',
          entity: { function: 'getVariable', variableName: 'unit' },
          scale: {
            function: 'calculate',
            items: [
              { operator: '+' },
              1,
              {
                function: 'calculate',
                items: [
                  { operator: '/' },
                  {
                    function: 'getPlayerAttribute',
                    attribute: SCORE_ATTR,
                    entity: { function: 'getOwner', entity: { function: 'getVariable', variableName: 'unit' } },
                  },
                  50,
                ],
              },
            ],
          },
        },
      ],
    },
    // Mirrors celleater's "make all green viruses scale=2.5" pass; uses forAllUnits with a
    // unitGroup filter. Pre-fix this would hit every unit on the map (player cells included).
    [VIRUS_RESCALE_SCRIPT]: {
      name: 'virus rescale',
      triggers: [],
      conditions: [{ operator: '==', operandType: 'boolean' }, true, true],
      actions: [
        {
          type: 'forAllUnits',
          unitGroup: { function: 'allUnitsOfUnitType', unitType: VIRUS_TYPE },
          actions: [
            { type: 'changeScaleOfEntitySprite', entity: { function: 'selectedUnit' }, scale: 2.5 },
          ],
        },
      ],
    },
  },
  variables: {},
};

describe('CellEater-style scale updates', () => {
  it('initializes player attributes from playerType on assignPlayerType', async () => {
    Engine.reset();
    const transport = createInMemoryPair();
    const server = new GameServer(transport.server);
    await server.init(FIXTURE as any);
    server.start();

    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P1', isMobile: false } });

    let player: any;
    for (const ent of (server as any)._entities.values()) {
      if (ent.category === 'player') player = ent;
    }
    expect(player).toBeDefined();
    expect(player.stats[`attr_${SCORE_ATTR}`]).toMatchObject({ value: 10, min: 10, max: 1000000 });

    server.stop();
    Engine.reset();
  });

  it('player cell scales from score attribute (1 + score/50)', async () => {
    Engine.reset();
    const transport = createInMemoryPair();
    const server = new GameServer(transport.server);
    await server.init(FIXTURE as any);
    server.start();

    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P1', isMobile: false } });

    const cells: any[] = [];
    let player: any;
    for (const ent of (server as any)._entities.values()) {
      if (ent.category === 'unit' && ent.stats?.type === CELL_TYPE) cells.push(ent);
      if (ent.category === 'player') player = ent;
    }
    // The script's `createUnitAtPosition` cell (the second one) goes through the size
    // script. The placeholder cell auto-spawned by _onJoinGame skips the script until the
    // first secondTick fires `forAllUnits(allUnitsOwnedByPlayer)`. We assert at least one
    // owned cell got the correct score-derived scale (1 + 10/50 = 1.2).
    const playerCells = cells.filter(c => c.stats.ownerId === player?.id);
    expect(playerCells.length).toBeGreaterThan(0);
    expect(playerCells.some(c => Math.abs(c.stats.scale - 1.2) < 1e-5)).toBe(true);

    server.stop();
    Engine.reset();
  });

  it('playerCameraTrackUnit destroys the placeholder and sends new InitConnection', async () => {
    Engine.reset();
    const transport = createInMemoryPair();
    const server = new GameServer(transport.server);
    await server.init(FIXTURE as any);
    server.start();

    const broadcasts: any[] = [];
    transport.client.onMessage((msg) => broadcasts.push(msg));
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P1', isMobile: false } });

    // After playerJoinsGame fires, only ONE cell should remain (placeholder destroyed
    // by playerCameraTrackUnit), and the latest InitConnection should reference the
    // script-spawned cell.
    const cells: any[] = [];
    let player: any;
    for (const ent of (server as any)._entities.values()) {
      if (ent.category === 'unit' && ent.stats?.type === CELL_TYPE) cells.push(ent);
      if (ent.category === 'player') player = ent;
    }
    const inits = broadcasts.filter(b => b?.type === MessageType.InitConnection);
    const lastInit = inits[inits.length - 1];

    const fs = await import('fs');
    fs.writeFileSync('/tmp/celltest.json', JSON.stringify({
      cellCount: cells.length,
      cells: cells.map(c => ({ id: c.id, ownerId: c.stats.ownerId })),
      initConnections: inits.map(i => i.data),
      lastFollowedUnit: lastInit?.data?.unitId,
    }, null, 2));

    expect(cells.length).toBe(1);
    expect(lastInit?.data?.unitId).toBe(cells[0].id);
  });

  it('forAllUnits honors unitGroup filter (virus rescale does not touch player cell)', async () => {
    Engine.reset();
    const transport = createInMemoryPair();
    const server = new GameServer(transport.server);
    await server.init(FIXTURE as any);
    server.start();

    transport.client.onMessage(() => {});
    await transport.client.connect();
    transport.client.send({ type: MessageType.JoinGame, data: { playerName: 'P1', isMobile: false } });

    // Spawn a virus so allUnitsOfUnitType(VIRUS_TYPE) returns it.
    (server as any).scripts.actions.run([
      { type: 'createUnitAtPosition', unitType: VIRUS_TYPE, entity: { function: 'getTriggeringPlayer' }, position: { x: 1, y: 1 }, angle: 0 },
    ], { triggeredBy: { playerId: 'fake' } });

    // Run the virus rescale script — should ONLY mutate units of VIRUS_TYPE.
    (server as any).scripts.runScript(VIRUS_RESCALE_SCRIPT, {});

    let cell: any, virus: any;
    for (const ent of (server as any)._entities.values()) {
      if (ent.category !== 'unit') continue;
      if (ent.stats?.type === CELL_TYPE) cell = ent;
      if (ent.stats?.type === VIRUS_TYPE) virus = ent;
    }
    expect(cell).toBeDefined();
    expect(virus).toBeDefined();
    expect(virus.stats.scale).toBeCloseTo(2.5, 5);
    // Pre-fix: cell.stats.scale would also be 2.5 because forAllUnits ignored the filter.
    expect(cell.stats.scale).not.toBeCloseTo(2.5, 2);

    server.stop();
    Engine.reset();
  });
});
