import { describe, it, expect } from 'vitest';
import { SpatialIndex } from '../../../engine/client/renderer/SpatialIndex';
import { Rect } from '../../../engine/core/math/Rect';

describe('SpatialIndex', () => {
  it('insert and query', () => {
    const index = new SpatialIndex<string>(100);
    index.insert('a', 50, 50);
    index.insert('b', 150, 150);
    index.insert('c', 500, 500);

    const results = index.query(new Rect(0, 0, 200, 200));
    expect(results).toContain('a');
    expect(results).toContain('b');
    expect(results).not.toContain('c');
  });

  it('empty query returns empty', () => {
    const index = new SpatialIndex<string>(100);
    expect(index.query(new Rect(0, 0, 100, 100))).toEqual([]);
  });

  it('clear removes all entries', () => {
    const index = new SpatialIndex<string>(100);
    index.insert('a', 50, 50);
    index.clear();
    expect(index.query(new Rect(0, 0, 200, 200))).toEqual([]);
  });
});
