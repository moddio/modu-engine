export type BrushSize = { x: number; y: number } | 'fitContent';
export type BrushShape = 'rectangle';

export interface SampleResult {
  sample: Record<number, Record<number, number>>;
  minX: number;
  minY: number;
  xLength: number;
  yLength: number;
}

/**
 * Brush extent + sampling. `calcSample` tiles `selectedTiles` across the brush extent
 * (or returns the bounding box as-is when `size === 'fitContent'`, used by flood-fill replay).
 */
export class TileShape {
  size: { x: number; y: number } = { x: 1, y: 1 };

  calcSample(
    selectedTiles: Record<number, Record<number, number>>,
    brushSize: BrushSize,
    _shape: BrushShape = 'rectangle',
    _mirrored = false,
  ): SampleResult {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const xs = Object.keys(selectedTiles).map(Number);
    for (const x of xs) {
      const col = selectedTiles[x];
      if (!col) continue;
      for (const yKey of Object.keys(col)) {
        const y = Number(yKey);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (minX === Number.POSITIVE_INFINITY) {
      return { sample: {}, minX: 0, minY: 0, xLength: 0, yLength: 0 };
    }
    const xLength = maxX - minX + 1;
    const yLength = maxY - minY + 1;

    if (brushSize === 'fitContent') {
      const sample: Record<number, Record<number, number>> = {};
      for (const x of xs) {
        const col = selectedTiles[x];
        if (!col) continue;
        const nx = x - minX;
        sample[nx] = {};
        for (const yKey of Object.keys(col)) {
          const y = Number(yKey);
          sample[nx][y - minY] = col[y];
        }
      }
      return { sample, minX, minY, xLength, yLength };
    }

    // Rectangle: tile the bounding box across the brush extent.
    const sample: Record<number, Record<number, number>> = {};
    for (let sx = 0; sx < brushSize.x; sx++) {
      const srcX = (sx % xLength) + minX;
      const srcCol = selectedTiles[srcX];
      if (!srcCol) continue;
      const col: Record<number, number> = {};
      for (let sy = 0; sy < brushSize.y; sy++) {
        const srcY = (sy % yLength) + minY;
        if (srcCol[srcY] === undefined) continue;
        col[sy] = srcCol[srcY];
      }
      sample[sx] = col;
    }
    return { sample, minX: 0, minY: 0, xLength: brushSize.x, yLength: brushSize.y };
  }
}
