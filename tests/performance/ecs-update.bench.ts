// tests/performance/ecs-update.bench.ts
import { bench, describe, beforeEach, afterEach } from 'vitest';
import { Engine } from '../../engine/core/Engine';
import { Component } from '../../engine/core/ecs/Component';

class PositionComponent extends Component {
  static readonly id = 'position';
  x = 0;
  y = 0;
  vx = 1;
  vy = 1;
  update(dt: number): void {
    this.x += this.vx * (dt / 1000);
    this.y += this.vy * (dt / 1000);
  }
}

class HealthComponent extends Component {
  static readonly id = 'health';
  current = 100;
  max = 100;
  regen = 1;
  update(dt: number): void {
    this.current = Math.min(this.max, this.current + this.regen * (dt / 1000));
  }
}

describe('ECS Update', () => {
  let engine: Engine;

  beforeEach(() => {
    Engine.reset();
    engine = Engine.instance();
  });

  afterEach(() => {
    Engine.reset();
  });

  bench('step with 100 entities, 2 components each', () => {
    for (let i = 0; i < 100; i++) {
      const e = engine.spawn();
      e.addComponent(new PositionComponent());
      e.addComponent(new HealthComponent());
    }
    engine.step(16.67);
  });

  bench('step with 500 entities, 1 component each', () => {
    for (let i = 0; i < 500; i++) {
      const e = engine.spawn();
      e.addComponent(new PositionComponent());
    }
    engine.step(16.67);
  });

  bench('spawn and destroy 100 entities', () => {
    const entities = [];
    for (let i = 0; i < 100; i++) {
      entities.push(engine.spawn());
    }
    for (const e of entities) {
      e.destroy();
    }
  });
});
