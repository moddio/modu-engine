import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Engine } from '../../../engine/core/Engine';
import { Entity } from '../../../engine/core/ecs/Entity';
import { Component } from '../../../engine/core/ecs/Component';
import { System } from '../../../engine/core/ecs/System';

class CounterComponent extends Component {
  static readonly id = 'counter';
  count = 0;
  update(dt: number): void { this.count++; }
}

class LogSystem extends System {
  readonly name = 'log';
  calls: number[] = [];
  update(dt: number, entities: Entity[]): void { this.calls.push(dt); }
}

describe('Engine', () => {
  let engine: Engine;

  beforeEach(() => { Engine.reset(); engine = Engine.instance(); });
  afterEach(() => { engine.stop(); });

  describe('singleton', () => {
    it('returns same instance', () => { expect(Engine.instance()).toBe(engine); });
    it('reset creates new instance', () => {
      const old = engine; Engine.reset();
      expect(Engine.instance()).not.toBe(old);
    });
  });

  describe('properties', () => {
    it('has a clock', () => { expect(engine.clock).toBeDefined(); expect(engine.clock.tickRate).toBe(60); });
    it('has an event emitter', () => { expect(engine.events).toBeDefined(); });
    it('has a root entity', () => { expect(engine.root).toBeDefined(); expect(engine.root).toBeInstanceOf(Entity); });
  });

  describe('entity management', () => {
    it('spawn creates entity mounted to root', () => {
      const e = engine.spawn();
      expect(e.parent).toBe(engine.root); expect(engine.root.children).toContain(e);
    });
    it('spawn with id', () => { expect(engine.spawn('player1').id).toBe('player1'); });
    it('findById returns entity', () => {
      const e = engine.spawn('findme');
      expect(engine.findById('findme')).toBe(e);
    });
    it('findById returns null for missing', () => { expect(engine.findById('nope')).toBeNull(); });
  });

  describe('systems', () => {
    it('addSystem registers', () => {
      const sys = new LogSystem(); engine.addSystem(sys);
      expect(engine.getSystem('log')).toBe(sys);
    });
    it('removeSystem unregisters', () => {
      const sys = new LogSystem(); engine.addSystem(sys); engine.removeSystem('log');
      expect(engine.getSystem('log')).toBeNull();
    });
  });

  describe('step', () => {
    it('advances the clock', () => {
      engine.step(16.67);
      expect(engine.clock.tick).toBe(1); expect(engine.clock.dt).toBeCloseTo(16.67);
    });
    it('updates all entities', () => {
      const e = engine.spawn();
      const counter = new CounterComponent();
      e.addComponent(counter);
      engine.step(16);
      expect(counter.count).toBe(1);
    });
    it('runs all systems', () => {
      const sys = new LogSystem(); engine.addSystem(sys);
      engine.step(16); engine.step(32);
      expect(sys.calls).toEqual([16, 32]);
    });
    it('emits preUpdate and postUpdate', () => {
      const pre = vi.fn(), post = vi.fn();
      engine.events.on('preUpdate', pre); engine.events.on('postUpdate', post);
      engine.step(16);
      expect(pre).toHaveBeenCalledOnce(); expect(post).toHaveBeenCalledOnce();
    });
  });
});
