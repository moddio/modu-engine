import { describe, it, expect } from 'vitest';
import { Serializer } from '../../../engine/core/network/Serializer';

describe('Serializer', () => {
  it('encodes and decodes object', () => {
    const data = { x: 10, y: 20, name: 'test' };
    const encoded = Serializer.encode(data);
    expect(encoded).toBeInstanceOf(Uint8Array);
    const decoded = Serializer.decode(encoded) as typeof data;
    expect(decoded.x).toBe(10);
    expect(decoded.y).toBe(20);
    expect(decoded.name).toBe('test');
  });

  it('encodes arrays', () => {
    const data = [1, 2, 3];
    const decoded = Serializer.decode(Serializer.encode(data));
    expect(decoded).toEqual([1, 2, 3]);
  });

  it('handles nested objects', () => {
    const data = { pos: { x: 1, y: 2 }, stats: { health: 100 } };
    const decoded = Serializer.decode(Serializer.encode(data)) as typeof data;
    expect(decoded.pos.x).toBe(1);
    expect(decoded.stats.health).toBe(100);
  });

  it('encodes to smaller size than JSON', () => {
    const data = { x: 100.5, y: 200.5, z: 0, angle: 1.5708, health: 100, name: 'unit1' };
    const msgpack = Serializer.encode(data);
    const json = new TextEncoder().encode(JSON.stringify(data));
    expect(msgpack.length).toBeLessThan(json.length);
  });
});
