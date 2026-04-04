// tests/performance/spatial-query.bench.ts
import { bench, describe, beforeEach } from 'vitest';
import { SpatialIndex } from '../../engine/client/renderer/SpatialIndex';
import { Rect } from '../../engine/core/math/Rect';

describe('Spatial Query', () => {
  let index: SpatialIndex<string>;

  beforeEach(() => {
    index = new SpatialIndex<string>(100);
    // Insert 1000 entities spread across a 5000x5000 world
    for (let i = 0; i < 1000; i++) {
      index.insert(`entity_${i}`, Math.random() * 5000, Math.random() * 5000);
    }
  });

  bench('query small viewport (800x600)', () => {
    index.query(new Rect(1000, 1000, 800, 600));
  });

  bench('query large viewport (2000x2000)', () => {
    index.query(new Rect(500, 500, 2000, 2000));
  });

  bench('insert 100 entities', () => {
    const fresh = new SpatialIndex<string>(100);
    for (let i = 0; i < 100; i++) {
      fresh.insert(`e_${i}`, Math.random() * 5000, Math.random() * 5000);
    }
  });

  bench('clear and rebuild 1000 entities', () => {
    index.clear();
    for (let i = 0; i < 1000; i++) {
      index.insert(`entity_${i}`, Math.random() * 5000, Math.random() * 5000);
    }
  });
});
