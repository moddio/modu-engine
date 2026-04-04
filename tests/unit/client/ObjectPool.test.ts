import { describe, it, expect } from 'vitest';
import { ObjectPool } from '../../../engine/client/renderer/ObjectPool';

describe('ObjectPool', () => {
  it('acquires new objects when empty', () => {
    const pool = new ObjectPool(() => ({ x: 0 }), (o) => { o.x = 0; });
    const obj = pool.acquire();
    expect(obj.x).toBe(0);
    expect(pool.available).toBe(0);
  });

  it('reuses released objects', () => {
    const pool = new ObjectPool(() => ({ x: 0 }), (o) => { o.x = 0; });
    const obj = pool.acquire();
    obj.x = 99;
    pool.release(obj);
    expect(pool.available).toBe(1);
    const reused = pool.acquire();
    expect(reused.x).toBe(0); // Reset
    expect(reused).toBe(obj); // Same reference
  });

  it('pre-allocates initial size', () => {
    const pool = new ObjectPool(() => ({ x: 0 }), (o) => { o.x = 0; }, 5);
    expect(pool.available).toBe(5);
  });

  it('clear empties pool', () => {
    const pool = new ObjectPool(() => ({ x: 0 }), (o) => { o.x = 0; }, 3);
    pool.clear();
    expect(pool.available).toBe(0);
  });
});
