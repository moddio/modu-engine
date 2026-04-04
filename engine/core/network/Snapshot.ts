import type { EntitySnapshot } from './Protocol';

export class WorldSnapshot {
  readonly tick: number;
  readonly entities: Map<string, EntitySnapshot>;

  constructor(tick: number, entities?: Map<string, EntitySnapshot>) {
    this.tick = tick;
    this.entities = entities ?? new Map();
  }

  setEntity(id: string, snapshot: EntitySnapshot): void {
    this.entities.set(id, snapshot);
  }

  getEntity(id: string): EntitySnapshot | undefined {
    return this.entities.get(id);
  }

  removeEntity(id: string): void {
    this.entities.delete(id);
  }

  clone(): WorldSnapshot {
    const cloned = new WorldSnapshot(this.tick);
    for (const [id, entity] of this.entities) {
      cloned.entities.set(id, { ...entity });
    }
    return cloned;
  }

  get entityCount(): number { return this.entities.size; }
}
