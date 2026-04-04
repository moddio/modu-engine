import { Entity } from '../ecs/Entity';
import { Rect } from '../math/Rect';

export interface RegionStats {
  name: string;
  [key: string]: unknown;
}

export class Region extends Entity {
  stats: RegionStats;
  bounds: Rect;

  constructor(id?: string, bounds?: Rect, stats?: Partial<RegionStats>) {
    super(id);
    this.category = 'region';
    this.bounds = bounds ?? new Rect(0, 0, 100, 100);
    this.stats = { name: '', ...stats };
  }

  containsPoint(x: number, y: number): boolean {
    return this.bounds.containsXY(x, y);
  }
}
