import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld3d } from '../../../engine/core/physics/PhysicsWorld3d';
import { Vec3 } from '../../../engine/core/math/Vec3';

beforeAll(async () => { await RAPIER.init(); });

describe('PhysicsWorld3d', () => {
  let world: PhysicsWorld3d;

  beforeEach(() => { world = new PhysicsWorld3d(new Vec3(0, -9.81, 0)); });
  afterEach(() => { world.destroy(); });

  it('creates with gravity', () => {
    expect(world.world).toBeDefined();
    expect(world.bodyCount).toBe(0);
  });

  it('creates dynamic body', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 10, 0) });
    expect(body.position.x).toBeCloseTo(0);
    expect(body.position.y).toBeCloseTo(10);
    expect(body.position.z).toBeCloseTo(0);
    expect(world.bodyCount).toBe(1);
  });

  it('creates static body', () => {
    const body = world.createBody({ type: 'static', position: new Vec3(0, 0, 0) });
    expect(body).toBeDefined();
  });

  it('creates kinematic body', () => {
    const body = world.createBody({ type: 'kinematic', position: new Vec3(5, 5, 5) });
    expect(body.position.x).toBeCloseTo(5);
  });

  it('destroys body', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    world.destroyBody(body);
    expect(world.bodyCount).toBe(0);
  });

  it('steps simulation with gravity', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 10, 0) });
    body.addCollider({ shape: 'sphere', radius: 0.5 });
    const startY = body.position.y;
    world.step(16.67);
    expect(body.position.y).toBeLessThan(startY);
  });

  it('getBody by handle', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    expect(world.getBody(body.handle)).toBe(body);
  });

  it('emits collision events', () => {
    const floor = world.createBody({ type: 'static', position: new Vec3(0, -1, 0) });
    floor.addCollider({ shape: 'box', halfExtents: new Vec3(50, 1, 50) });

    const ball = world.createBody({ type: 'dynamic', position: new Vec3(0, 5, 0) });
    ball.addCollider({ shape: 'sphere', radius: 0.5 });

    let collisionDetected = false;
    world.events.on('collisionStart', () => { collisionDetected = true; });

    for (let i = 0; i < 120; i++) world.step(16.67);
    expect(collisionDetected).toBe(true);
  });

  it('defaults to negative Y gravity', () => {
    const w = new PhysicsWorld3d();
    const body = w.createBody({ type: 'dynamic', position: new Vec3(0, 10, 0) });
    body.addCollider({ shape: 'sphere', radius: 0.5 });
    w.step(16.67);
    expect(body.position.y).toBeLessThan(10);
    w.destroy();
  });
});
