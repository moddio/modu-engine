import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier2d-compat';
import { PhysicsWorld } from '../../../engine/core/physics/PhysicsWorld';
import { Vec2 } from '../../../engine/core/math/Vec2';

beforeAll(async () => {
  await RAPIER.init();
});

describe('PhysicsWorld', () => {
  let world: PhysicsWorld;

  beforeEach(() => { world = new PhysicsWorld(new Vec2(0, -9.81)); });
  afterEach(() => { world.destroy(); });

  it('creates with gravity', () => {
    expect(world.world).toBeDefined();
    expect(world.bodyCount).toBe(0);
  });

  it('creates dynamic body', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 10) });
    expect(body).toBeDefined();
    expect(body.position.x).toBeCloseTo(0);
    expect(body.position.y).toBeCloseTo(10);
    expect(world.bodyCount).toBe(1);
  });

  it('creates static body', () => {
    const body = world.createBody({ type: 'static', position: new Vec2(0, 0) });
    expect(body).toBeDefined();
    expect(world.bodyCount).toBe(1);
  });

  it('creates kinematic body', () => {
    const body = world.createBody({ type: 'kinematic', position: new Vec2(5, 5) });
    expect(body).toBeDefined();
    expect(body.position.x).toBeCloseTo(5);
  });

  it('destroys body', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 0) });
    expect(world.bodyCount).toBe(1);
    world.destroyBody(body);
    expect(world.bodyCount).toBe(0);
  });

  it('steps simulation', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 10) });
    body.addCollider({ shape: 'circle', radius: 0.5 });
    const startY = body.position.y;
    world.step(16.67); // one frame at 60fps
    // With gravity -9.81, body should have moved down
    expect(body.position.y).toBeLessThan(startY);
  });

  it('getBody by handle', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 0) });
    expect(world.getBody(body.handle)).toBe(body);
  });

  it('emits collision events', () => {
    const floor = world.createBody({ type: 'static', position: new Vec2(0, -1) });
    floor.addCollider({ shape: 'box', width: 50, height: 1 });

    const ball = world.createBody({ type: 'dynamic', position: new Vec2(0, 2) });
    ball.addCollider({ shape: 'circle', radius: 0.5 });

    let collisionDetected = false;
    world.events.on('collisionStart', () => { collisionDetected = true; });

    // Step many times to let ball fall
    for (let i = 0; i < 120; i++) world.step(16.67);
    expect(collisionDetected).toBe(true);
  });

  it('defaults to zero gravity', () => {
    const zeroWorld = new PhysicsWorld();
    const body = zeroWorld.createBody({ type: 'dynamic', position: new Vec2(0, 10) });
    body.addCollider({ shape: 'circle', radius: 0.5 });
    zeroWorld.step(16.67);
    expect(body.position.y).toBeCloseTo(10, 0); // should barely move
    zeroWorld.destroy();
  });
});
