/**
 * EntityTypeRegistry — loads entity type definitions from game data
 * and provides clone access for instantiation.
 */
export class EntityTypeRegistry {
  private _types = new Map<string, Map<string, Record<string, unknown>>>();

  load(entities: Record<string, Record<string, unknown> | undefined>): void {
    for (const [category, types] of Object.entries(entities)) {
      if (!types) continue;
      const map = new Map<string, Record<string, unknown>>();
      for (const [id, def] of Object.entries(types)) {
        map.set(id, def as Record<string, unknown>);
      }
      this._types.set(category, map);
    }
  }

  get(category: string, typeId: string): Record<string, unknown> | null {
    return this._types.get(category)?.get(typeId) ?? null;
  }

  /** Deep clone a type definition for instantiation */
  clone(category: string, typeId: string): Record<string, unknown> | null {
    const def = this.get(category, typeId);
    if (!def) return null;
    return JSON.parse(JSON.stringify(def));
  }

  getAll(category: string): Map<string, Record<string, unknown>> {
    return this._types.get(category) ?? new Map();
  }

  get categoryCount(): number {
    return this._types.size;
  }

  typeCount(category: string): number {
    return this._types.get(category)?.size ?? 0;
  }
}
