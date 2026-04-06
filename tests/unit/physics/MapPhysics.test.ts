import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier2d-compat';
import { PhysicsWorld } from '../../../engine/core/physics/PhysicsWorld';
import { Vec2 } from '../../../engine/core/math/Vec2';
import { createWallBodiesFromMap } from '../../../engine/core/physics/MapPhysics';

beforeAll(async () => {
  await RAPIER.init();
});

describe('MapPhysics', () => {
  let world: PhysicsWorld;

  beforeEach(() => { world = new PhysicsWorld(); });
  afterEach(() => { world.destroy(); });

  it('creates correct number of bodies for non-zero tiles', () => {
    // 3x3 map, 4 wall tiles
    const layerData = [
      1, 0, 1,
      0, 0, 0,
      1, 0, 1,
    ];
    const bodies = createWallBodiesFromMap(world, layerData, 3, 3, 64, 64);
    expect(bodies).toHaveLength(4);
    expect(world.bodyCount).toBe(4);
  });

  it('creates no bodies for empty tiles', () => {
    const layerData = [0, 0, 0, 0];
    const bodies = createWallBodiesFromMap(world, layerData, 2, 2, 64, 64);
    expect(bodies).toHaveLength(0);
    expect(world.bodyCount).toBe(0);
  });

  it('bodies are static type', () => {
    const layerData = [1, 0, 0, 0];
    const bodies = createWallBodiesFromMap(world, layerData, 2, 2, 64, 64);
    expect(bodies).toHaveLength(1);
    // Static bodies should not move when stepped
    const pos = bodies[0].position;
    world.step(16.67);
    expect(bodies[0].position.x).toBeCloseTo(pos.x);
    expect(bodies[0].position.y).toBeCloseTo(pos.y);
  });

  it('positions bodies at tile centers', () => {
    // Single tile at (0,0) in a 1x1 map with tileWidth=64, scaleRatio=64
    // worldTileW = 64/64 = 1, center = 0*1 + 0.5 = 0.5
    const layerData = [1];
    const bodies = createWallBodiesFromMap(world, layerData, 1, 1, 64, 64, 64);
    expect(bodies[0].position.x).toBeCloseTo(0.5);
    expect(bodies[0].position.y).toBeCloseTo(0.5);
  });

  it('respects custom scaleRatio', () => {
    const layerData = [1];
    const bodies = createWallBodiesFromMap(world, layerData, 1, 1, 32, 32, 32);
    // worldTileW = 32/32 = 1, center = 0.5
    expect(bodies[0].position.x).toBeCloseTo(0.5);
  });

  it('handles full wall map', () => {
    const layerData = [1, 2, 3, 4]; // all non-zero
    const bodies = createWallBodiesFromMap(world, layerData, 2, 2, 64, 64);
    expect(bodies).toHaveLength(4);
  });
});
