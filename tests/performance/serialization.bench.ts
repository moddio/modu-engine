// tests/performance/serialization.bench.ts
import { bench, describe } from 'vitest';
import { Serializer } from '../../engine/core/network/Serializer';
import { DeltaCompressor } from '../../engine/core/network/DeltaCompressor';

describe('Serialization', () => {
  const smallPayload = { x: 100.5, y: 200.3, angle: 1.57, health: 75 };
  const largePayload = {
    entities: Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [
        `entity_${i}`,
        { id: `entity_${i}`, x: Math.random() * 1000, y: Math.random() * 1000, angle: Math.random() * 6.28, health: Math.floor(Math.random() * 100) }
      ])
    )
  };

  bench('encode small payload', () => {
    Serializer.encode(smallPayload);
  });

  bench('decode small payload', () => {
    const encoded = Serializer.encode(smallPayload);
    Serializer.decode(encoded);
  });

  bench('encode large payload (100 entities)', () => {
    Serializer.encode(largePayload);
  });

  bench('decode large payload (100 entities)', () => {
    const encoded = Serializer.encode(largePayload);
    Serializer.decode(encoded);
  });

  bench('delta compress (10% changed)', () => {
    const prev: Record<string, unknown> = {};
    const curr: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      prev[`key_${i}`] = i;
      curr[`key_${i}`] = i < 10 ? i + 1 : i; // 10 changed
    }
    DeltaCompressor.diff(prev, curr);
  });

  bench('delta apply', () => {
    const base: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) base[`key_${i}`] = i;
    const delta = { key_0: 999, key_5: 888, key_10: 777 };
    DeltaCompressor.apply(base, delta);
  });
});
