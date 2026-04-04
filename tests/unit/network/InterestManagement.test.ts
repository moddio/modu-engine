import { describe, it, expect } from 'vitest';
import { InterestManagement } from '../../../engine/core/network/InterestManagement';
import { Vec2 } from '../../../engine/core/math/Vec2';
import type { EntitySnapshot } from '../../../engine/core/network/Protocol';

describe('InterestManagement', () => {
  function makeEntities(): Map<string, EntitySnapshot> {
    const m = new Map<string, EntitySnapshot>();
    m.set('near', { id: 'near', category: 'unit', x: 50, y: 50, z: 0, angle: 0 });
    m.set('far', { id: 'far', category: 'unit', x: 5000, y: 5000, z: 0, angle: 0 });
    m.set('mid', { id: 'mid', category: 'unit', x: 500, y: 0, z: 0, angle: 0 });
    return m;
  }

  it('filters by range', () => {
    const im = new InterestManagement(1000);
    const relevant = im.getRelevantEntities(new Vec2(0, 0), makeEntities());
    const ids = relevant.map(e => e.id);
    expect(ids).toContain('near');
    expect(ids).toContain('mid');
    expect(ids).not.toContain('far');
  });

  it('always includes specified entities', () => {
    const im = new InterestManagement(100); // Very small range
    const always = new Set(['far']);
    const relevant = im.getRelevantEntities(new Vec2(0, 0), makeEntities(), always);
    const ids = relevant.map(e => e.id);
    expect(ids).toContain('far');
  });

  it('range can be changed', () => {
    const im = new InterestManagement(10);
    expect(im.getRelevantEntities(new Vec2(0, 0), makeEntities()).length).toBe(0);
    im.range = 10000;
    expect(im.getRelevantEntities(new Vec2(0, 0), makeEntities()).length).toBe(3);
  });
});
