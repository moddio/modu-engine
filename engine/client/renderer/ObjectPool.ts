export class ObjectPool<T> {
  private _pool: T[] = [];
  private _factory: () => T;
  private _reset: (obj: T) => void;

  constructor(factory: () => T, reset: (obj: T) => void, initialSize: number = 0) {
    this._factory = factory;
    this._reset = reset;
    for (let i = 0; i < initialSize; i++) this._pool.push(factory());
  }

  acquire(): T {
    return this._pool.length > 0 ? this._pool.pop()! : this._factory();
  }

  release(obj: T): void {
    this._reset(obj);
    this._pool.push(obj);
  }

  get available(): number { return this._pool.length; }

  clear(): void { this._pool = []; }
}
