export class Map2d<T = number> {
  private _data: (T | undefined)[][];

  constructor(
    readonly width: number,
    readonly height: number,
    defaultValue?: T,
  ) {
    this._data = [];
    for (let y = 0; y < height; y++) {
      this._data[y] = [];
      for (let x = 0; x < width; x++) {
        this._data[y][x] = defaultValue;
      }
    }
  }

  get(x: number, y: number): T | undefined {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return undefined;
    return this._data[y][x];
  }

  set(x: number, y: number, value: T): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    this._data[y][x] = value;
  }

  isInBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  fill(value: T): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this._data[y][x] = value;
      }
    }
  }

  clear(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this._data[y][x] = undefined;
      }
    }
  }
}
