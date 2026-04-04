import { Vec2 } from '../math/Vec2';
import type { EntitySnapshot } from './Protocol';

export class InterestManagement {
  private _range: number;

  constructor(range: number = 1000) {
    this._range = range;
  }

  get range(): number { return this._range; }
  set range(value: number) { this._range = value; }

  getRelevantEntities(
    playerPosition: Vec2,
    entities: Map<string, EntitySnapshot>,
    alwaysInclude?: Set<string>,
  ): EntitySnapshot[] {
    const relevant: EntitySnapshot[] = [];

    for (const [id, entity] of entities) {
      if (alwaysInclude?.has(id)) {
        relevant.push(entity);
        continue;
      }

      const dx = entity.x - playerPosition.x;
      const dy = entity.y - playerPosition.y;
      const distSq = dx * dx + dy * dy;

      if (distSq <= this._range * this._range) {
        relevant.push(entity);
      }
    }

    return relevant;
  }
}
