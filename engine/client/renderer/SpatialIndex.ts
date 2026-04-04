import { Rect } from '../../core/math/Rect';

interface SpatialEntry<T> {
  item: T;
  x: number;
  y: number;
}

export class SpatialIndex<T> {
  private _cellSize: number;
  private _cells = new Map<string, SpatialEntry<T>[]>();

  constructor(cellSize: number = 200) {
    this._cellSize = cellSize;
  }

  private _key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  insert(item: T, x: number, y: number): void {
    const cx = Math.floor(x / this._cellSize);
    const cy = Math.floor(y / this._cellSize);
    const key = this._key(cx, cy);
    let cell = this._cells.get(key);
    if (!cell) { cell = []; this._cells.set(key, cell); }
    cell.push({ item, x, y });
  }

  query(rect: Rect): T[] {
    const results: T[] = [];
    const minCx = Math.floor(rect.x / this._cellSize);
    const minCy = Math.floor(rect.y / this._cellSize);
    const maxCx = Math.floor((rect.x + rect.width) / this._cellSize);
    const maxCy = Math.floor((rect.y + rect.height) / this._cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const cell = this._cells.get(this._key(cx, cy));
        if (cell) {
          for (const entry of cell) {
            if (rect.containsXY(entry.x, entry.y)) results.push(entry.item);
          }
        }
      }
    }
    return results;
  }

  clear(): void { this._cells.clear(); }
}
