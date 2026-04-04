import { describe, it, expect, vi } from 'vitest';
import { System } from '../../../engine/core/ecs/System';
import { Entity } from '../../../engine/core/ecs/Entity';

describe('System', () => {
  it('can be extended with custom update logic', () => {
    const updateFn = vi.fn();
    class TestSystem extends System {
      update(dt: number, entities: Entity[]): void { updateFn(dt, entities.length); }
    }
    const sys = new TestSystem();
    sys.update(16, [new Entity(), new Entity()]);
    expect(updateFn).toHaveBeenCalledWith(16, 2);
  });
  it('has a name', () => {
    class PhysicsSystem extends System {
      readonly name = 'physics';
      update(): void {}
    }
    expect(new PhysicsSystem().name).toBe('physics');
  });
});
