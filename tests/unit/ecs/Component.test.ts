import { describe, it, expect } from 'vitest';
import { Component } from '../../../engine/core/ecs/Component';

class TestComponent extends Component {
  static readonly id = 'test';
  value = 0;
  update(dt: number): void { this.value += dt; }
}

describe('Component', () => {
  it('has a static id', () => { expect(TestComponent.id).toBe('test'); });
  it('starts without an entity reference', () => { expect(new TestComponent().entity).toBeNull(); });
  it('update is callable', () => { const c = new TestComponent(); c.update(16); expect(c.value).toBe(16); });
  it('destroy is callable', () => { expect(() => new TestComponent().destroy()).not.toThrow(); });
});
