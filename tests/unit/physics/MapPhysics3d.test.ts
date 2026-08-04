import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld3d } from '../../../engine/core/physics/PhysicsWorld3d';
import { createWallBodiesFromMap3d } from '../../../engine/core/physics/MapPhysics3d';
import { Vec3 } from '../../../engine/core/math/Vec3';

beforeAll(async () => { await RAPIER.init(); });

/**
 * A 2x1 map. Cell 0 is walled on all three layers, cell 1 on none — so the map has one
 * wall column, three tiles tall, and one empty square. This mirrors how the editor
 * actually stores height: braains3d stacks `walls`, `walls2`, `walls3` and `walls4` on
 * an identical set of 408 cells, one layer per storey.
 */
const LAYERS = [[1, 0], [1, 0], [1, 0]];
const TILE_PX = 16;
const SCALE = 30;
const tile = TILE_PX / SCALE;

describe('MapPhysics3d', () => {
  let world: PhysicsWorld3d;
  afterEach(() => { world?.destroy(); });

  const build = () => {
    world = new PhysicsWorld3d(new Vec3(0, -9.81, 0));
    return createWallBodiesFromMap3d(world, LAYERS, 2, 1, TILE_PX, SCALE);
  };

  it('creates one body per occupied column, not one per layer', () => {
    // Three stacked layers must not become three colliders: overlapping boxes give a
    // unit internal faces to catch on, and triple the broad-phase work.
    expect(build()).toHaveLength(1);
  });

  it('makes the column as tall as the number of stacked layers', () => {
    const [body] = build();
    // The centre sits at half the column height, so the base rests on y = 0.
    expect(body.position.y).toBeCloseTo((3 * tile) / 2, 5);
  });

  it('leaves empty cells empty', () => {
    const bodies = build();
    expect(bodies[0].position.x).toBeCloseTo(tile / 2, 5);
  });

  it('holds a falling box up on top of the column instead of letting it through', () => {
    build();
    const box = world.createBody({ type: 'dynamic', position: new Vec3(tile / 2, 3 * tile + 2, tile / 2) });
    box.addCollider({ shape: 'box', halfExtents: new Vec3(tile / 4, tile / 4, tile / 4), density: 1 });
    for (let i = 0; i < 240; i++) world.step(16);
    // Resting on a 3-tile column, so its centre is a quarter-tile above the top face.
    expect(box.position.y).toBeGreaterThan(3 * tile);
    expect(box.position.y).toBeLessThan(3 * tile + tile);
  });

  it('lets a box fall to the ground where there is no wall', () => {
    build();
    const box = world.createBody({ type: 'dynamic', position: new Vec3(tile * 1.5, 3 * tile + 2, tile / 2) });
    box.addCollider({ shape: 'box', halfExtents: new Vec3(tile / 4, tile / 4, tile / 4), density: 1 });
    for (let i = 0; i < 240; i++) world.step(16);
    expect(box.position.y).toBeLessThan(0);
  });
});
