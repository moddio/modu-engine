import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier2d-compat';
import { PhysicsWorld } from '../../../engine/core/physics/PhysicsWorld';
import { Vec2 } from '../../../engine/core/math/Vec2';

beforeAll(async () => {
  await RAPIER.init();
});

describe('Collider', () => {
  let world: PhysicsWorld;

  beforeEach(() => { world = new PhysicsWorld(); });
  afterEach(() => { world.destroy(); });

  it('sets friction', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 0) });
    const collider = body.addCollider({ shape: 'box', width: 1, height: 1, friction: 0.5 });
    expect(collider.friction()).toBeCloseTo(0.5);
  });

  it('sets restitution', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 0) });
    const collider = body.addCollider({ shape: 'circle', radius: 1, restitution: 0.8 });
    expect(collider.restitution()).toBeCloseTo(0.8);
  });

  it('sets density', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 0) });
    const collider = body.addCollider({ shape: 'circle', radius: 1, density: 2.0 });
    expect(collider.density()).toBeCloseTo(2.0);
  });
});
