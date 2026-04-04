import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld3d } from '../../../engine/core/physics/PhysicsWorld3d';
import { Vec3 } from '../../../engine/core/math/Vec3';

beforeAll(async () => { await RAPIER.init(); });

describe('RigidBody3d', () => {
  let world: PhysicsWorld3d;

  beforeEach(() => { world = new PhysicsWorld3d(new Vec3(0, 0, 0)); });
  afterEach(() => { world.destroy(); });

  it('has a handle', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    expect(typeof body.handle).toBe('number');
  });

  it('get/set position', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(1, 2, 3) });
    expect(body.position.x).toBeCloseTo(1);
    expect(body.position.y).toBeCloseTo(2);
    expect(body.position.z).toBeCloseTo(3);
    body.position = new Vec3(10, 20, 30);
    expect(body.position.x).toBeCloseTo(10);
    expect(body.position.y).toBeCloseTo(20);
    expect(body.position.z).toBeCloseTo(30);
  });

  it('get/set rotation quaternion', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    // 90 degrees around Y axis
    const q = { x: 0, y: 0.7071, z: 0, w: 0.7071 };
    body.rotation = q;
    const r = body.rotation;
    expect(r.y).toBeCloseTo(0.7071, 3);
    expect(r.w).toBeCloseTo(0.7071, 3);
  });

  it('get/set linearVelocity', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    body.linearVelocity = new Vec3(5, 0, -3);
    expect(body.linearVelocity.x).toBeCloseTo(5);
    expect(body.linearVelocity.z).toBeCloseTo(-3);
  });

  it('get/set angularVelocity', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    body.angularVelocity = new Vec3(0, 1, 0);
    expect(body.angularVelocity.y).toBeCloseTo(1);
  });

  it('applyImpulse changes velocity', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    body.addCollider({ shape: 'sphere', radius: 1, density: 1 });
    body.applyImpulse(new Vec3(10, 0, 0));
    world.step(16.67);
    expect(body.linearVelocity.x).toBeGreaterThan(0);
  });

  it('addCollider box', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    const collider = body.addCollider({ shape: 'box', halfExtents: new Vec3(2, 1, 3) });
    expect(collider).toBeDefined();
  });

  it('addCollider sphere', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    const collider = body.addCollider({ shape: 'sphere', radius: 1.5 });
    expect(collider).toBeDefined();
  });

  it('addCollider sensor', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    const collider = body.addCollider({ shape: 'sphere', radius: 1, isSensor: true });
    expect(collider.isSensor()).toBe(true);
  });

  it('isSleeping', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    body.addCollider({ shape: 'sphere', radius: 1 });
    expect(typeof body.isSleeping).toBe('boolean');
  });

  it('applyTorque', () => {
    const body = world.createBody({ type: 'dynamic', position: new Vec3(0, 0, 0) });
    body.addCollider({ shape: 'box', halfExtents: new Vec3(1, 1, 1), density: 1 });
    body.applyTorque(new Vec3(0, 10, 0));
    world.step(16.67);
    expect(body.angularVelocity.y).toBeGreaterThan(0);
  });
});
