// tests/performance/physics-stress.bench.ts
import { bench, describe, beforeAll, beforeEach, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier2d-compat';
import { PhysicsWorld } from '../../engine/core/physics/PhysicsWorld';
import { Vec2 } from '../../engine/core/math/Vec2';

beforeAll(async () => { await RAPIER.init(); });

describe('Physics Stress', () => {
  let world: PhysicsWorld;

  beforeEach(() => { world = new PhysicsWorld(new Vec2(0, -9.81)); });
  afterEach(() => { world.destroy(); });

  bench('step with 100 dynamic bodies', () => {
    // Setup once outside bench if needed, but vitest bench re-runs setup
    for (let i = 0; i < 100; i++) {
      const body = world.createBody({ type: 'dynamic', position: new Vec2(Math.random() * 100, Math.random() * 100) });
      body.addCollider({ shape: 'circle', radius: 0.5 });
    }
    world.step(16.67);
  });

  bench('step with 50 bodies (mixed static/dynamic)', () => {
    for (let i = 0; i < 25; i++) {
      const s = world.createBody({ type: 'static', position: new Vec2(i * 4, 0) });
      s.addCollider({ shape: 'box', width: 2, height: 0.5 });
    }
    for (let i = 0; i < 25; i++) {
      const d = world.createBody({ type: 'dynamic', position: new Vec2(i * 4, 10 + Math.random() * 5) });
      d.addCollider({ shape: 'circle', radius: 0.5 });
    }
    world.step(16.67);
  });

  bench('create and destroy 100 bodies', () => {
    const bodies = [];
    for (let i = 0; i < 100; i++) {
      bodies.push(world.createBody({ type: 'dynamic', position: new Vec2(i, 0) }));
    }
    for (const body of bodies) {
      world.destroyBody(body);
    }
  });
});
