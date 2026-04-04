import { describe, it, expect, vi } from 'vitest';
import { Entity } from '../../../engine/core/ecs/Entity';
import { Component } from '../../../engine/core/ecs/Component';
import { Vec3 } from '../../../engine/core/math/Vec3';

class HealthComponent extends Component {
  static readonly id = 'health';
  current = 100;
  max = 100;
  update(dt: number): void { this.current = Math.min(this.current + dt / 1000, this.max); }
}

class SpeedComponent extends Component {
  static readonly id = 'speed';
  value = 5;
}

describe('Entity', () => {
  describe('identification', () => {
    it('generates unique id', () => {
      const a = new Entity(), b = new Entity();
      expect(a.id).toBeTruthy(); expect(b.id).toBeTruthy(); expect(a.id).not.toBe(b.id);
    });
    it('accepts custom id', () => { expect(new Entity('custom-id').id).toBe('custom-id'); });
  });

  describe('lifecycle', () => {
    it('starts alive', () => { expect(new Entity().alive).toBe(true); });
    it('destroy sets alive to false', () => { const e = new Entity(); e.destroy(); expect(e.alive).toBe(false); });
    it('destroy removes from parent', () => {
      const parent = new Entity(), child = new Entity();
      child.mount(parent); child.destroy();
      expect(parent.children.length).toBe(0);
    });
    it('destroy recursively destroys children', () => {
      const parent = new Entity(), child = new Entity(), grandchild = new Entity();
      child.mount(parent); grandchild.mount(child);
      parent.destroy();
      expect(child.alive).toBe(false); expect(grandchild.alive).toBe(false);
    });
    it('destroy calls destroy on components', () => {
      const e = new Entity();
      const comp = new HealthComponent();
      const spy = vi.spyOn(comp, 'destroy');
      e.addComponent(comp); e.destroy();
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe('parent/child', () => {
    it('mount sets parent and adds to children', () => {
      const parent = new Entity(), child = new Entity();
      child.mount(parent);
      expect(child.parent).toBe(parent); expect(parent.children).toContain(child);
    });
    it('unmount removes from parent', () => {
      const parent = new Entity(), child = new Entity();
      child.mount(parent); child.unmount();
      expect(child.parent).toBeNull(); expect(parent.children.length).toBe(0);
    });
    it('mounting to new parent unmounts from old', () => {
      const p1 = new Entity(), p2 = new Entity(), child = new Entity();
      child.mount(p1); child.mount(p2);
      expect(p1.children.length).toBe(0); expect(p2.children).toContain(child); expect(child.parent).toBe(p2);
    });
    it('cannot mount to self', () => {
      const e = new Entity();
      expect(() => e.mount(e)).toThrow();
    });
  });

  describe('components', () => {
    it('addComponent attaches', () => {
      const e = new Entity(), h = new HealthComponent();
      e.addComponent(h);
      expect(e.getComponent(HealthComponent)).toBe(h); expect(h.entity).toBe(e);
    });
    it('getComponent returns null if not found', () => { expect(new Entity().getComponent(HealthComponent)).toBeNull(); });
    it('hasComponent', () => {
      const e = new Entity();
      expect(e.hasComponent(HealthComponent)).toBe(false);
      e.addComponent(new HealthComponent());
      expect(e.hasComponent(HealthComponent)).toBe(true);
    });
    it('removeComponent detaches', () => {
      const e = new Entity(), h = new HealthComponent();
      e.addComponent(h); e.removeComponent(HealthComponent);
      expect(e.getComponent(HealthComponent)).toBeNull(); expect(h.entity).toBeNull();
    });
    it('removeComponent calls destroy', () => {
      const e = new Entity(), h = new HealthComponent();
      const spy = vi.spyOn(h, 'destroy');
      e.addComponent(h); e.removeComponent(HealthComponent);
      expect(spy).toHaveBeenCalledOnce();
    });
    it('supports multiple types', () => {
      const e = new Entity();
      e.addComponent(new HealthComponent()); e.addComponent(new SpeedComponent());
      expect(e.getComponent(HealthComponent)?.current).toBe(100);
      expect(e.getComponent(SpeedComponent)?.value).toBe(5);
    });
  });

  describe('transform', () => {
    it('position defaults to origin', () => { expect(new Entity().position.equals(Vec3.zero())).toBe(true); });
    it('position can be set', () => { const e = new Entity(); e.position.set(10, 20, 30); expect(e.position.x).toBe(10); });
    it('rotation defaults to zero', () => { expect(new Entity().rotation).toBe(0); });
    it('scale defaults to (1,1,1)', () => { expect(new Entity().scale.equals(Vec3.one())).toBe(true); });
  });

  describe('category', () => {
    it('can set and get', () => { const e = new Entity(); e.category = 'unit'; expect(e.category).toBe('unit'); });
    it('defaults to empty', () => { expect(new Entity().category).toBe(''); });
  });

  describe('update', () => {
    it('updates all components', () => {
      const e = new Entity(), h = new HealthComponent(); h.current = 50;
      e.addComponent(h); e.update(1000);
      expect(h.current).toBe(51);
    });
    it('does not update if not alive', () => {
      const e = new Entity(), h = new HealthComponent(); h.current = 50;
      e.addComponent(h); e.destroy(); e.update(1000);
      expect(h.current).toBe(50);
    });
  });

  describe('layer and depth', () => {
    it('layer defaults to 0', () => { expect(new Entity().layer).toBe(0); });
    it('depth defaults to 0', () => { expect(new Entity().depth).toBe(0); });
    it('can be set', () => { const e = new Entity(); e.layer = 5; e.depth = 10; expect(e.layer).toBe(5); expect(e.depth).toBe(10); });
  });
});
