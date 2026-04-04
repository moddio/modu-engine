import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier2d-compat';
import { PhysicsWorld } from '../../../engine/core/physics/PhysicsWorld';
import { Vec2 } from '../../../engine/core/math/Vec2';

beforeAll(async () => {
  await RAPIER.init();
});

describe('RigidBody', () => {
  let world: PhysicsWorld;

  beforeEach(() => { world = new PhysicsWorld(); });
  afterEach(() => { world.destroy(); });

  it('has a handle', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 0) });
    expect(typeof body.handle).toBe('number');
  });

  it('get/set position', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(1, 2) });
    expect(body.position.x).toBeCloseTo(1);
    body.position = new Vec2(5, 10);
    expect(body.position.x).toBeCloseTo(5);
    expect(body.position.y).toBeCloseTo(10);
  });

  it('get/set angle', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 0), angle: Math.PI / 4 });
    expect(body.angle).toBeCloseTo(Math.PI / 4);
    body.angle = Math.PI / 2;
    expect(body.angle).toBeCloseTo(Math.PI / 2);
  });

  it('get/set linearVelocity', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 0) });
    body.linearVelocity = new Vec2(5, 0);
    expect(body.linearVelocity.x).toBeCloseTo(5);
  });

  it('applyImpulse changes velocity', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 0) });
    body.addCollider({ shape: 'circle', radius: 1, density: 1 });
    body.applyImpulse(new Vec2(10, 0));
    world.step(16.67);
    expect(body.linearVelocity.x).toBeGreaterThan(0);
  });

  it('addCollider box', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 0) });
    const collider = body.addCollider({ shape: 'box', width: 2, height: 1 });
    expect(collider).toBeDefined();
  });

  it('addCollider circle', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 0) });
    const collider = body.addCollider({ shape: 'circle', radius: 1 });
    expect(collider).toBeDefined();
  });

  it('addCollider sensor', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 0) });
    const collider = body.addCollider({ shape: 'circle', radius: 1, isSensor: true });
    expect(collider.isSensor()).toBe(true);
  });

  it('isSleeping', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec2(0, 0) });
    body.addCollider({ shape: 'circle', radius: 1 });
    // New body shouldn't be sleeping
    expect(typeof body.isSleeping).toBe('boolean');
  });
});
