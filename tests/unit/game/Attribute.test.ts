import { describe, it, expect } from 'vitest';
import { AttributeManager } from '../../../engine/core/game/Attribute';

describe('AttributeManager', () => {
  it('define and get', () => {
    const am = new AttributeManager();
    am.define({ name: 'health', value: 100, min: 0, max: 100, regeneration: 0 });
    expect(am.get('health')).toBe(100);
  });

  it('set clamps to range', () => {
    const am = new AttributeManager();
    am.define({ name: 'health', value: 100, min: 0, max: 100, regeneration: 0 });
    am.set('health', 150);
    expect(am.get('health')).toBe(100);
    am.set('health', -50);
    expect(am.get('health')).toBe(0);
  });

  it('modify adds delta', () => {
    const am = new AttributeManager();
    am.define({ name: 'health', value: 50, min: 0, max: 100, regeneration: 0 });
    am.modify('health', -20);
    expect(am.get('health')).toBe(30);
    am.modify('health', 80);
    expect(am.get('health')).toBe(100); // clamped
  });

  it('regeneration over time', () => {
    const am = new AttributeManager();
    am.define({ name: 'mana', value: 50, min: 0, max: 100, regeneration: 10 }); // 10/sec
    am.update(1000); // 1 second
    expect(am.get('mana')).toBe(60);
  });

  it('regeneration does not exceed max', () => {
    const am = new AttributeManager();
    am.define({ name: 'mana', value: 95, min: 0, max: 100, regeneration: 10 });
    am.update(1000);
    expect(am.get('mana')).toBe(100);
  });

  it('getMax returns max value', () => {
    const am = new AttributeManager();
    am.define({ name: 'health', value: 50, min: 0, max: 200, regeneration: 0 });
    expect(am.getMax('health')).toBe(200);
  });

  it('undefined for unknown attribute', () => {
    const am = new AttributeManager();
    expect(am.get('unknown')).toBeUndefined();
  });
});
