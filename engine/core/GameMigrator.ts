interface OldGameData {
  data: {
    scripts?: Record<string, OldScript>;
    unitTypes?: Record<string, unknown>;
    itemTypes?: Record<string, unknown>;
    projectileTypes?: Record<string, unknown>;
    playerTypes?: Record<string, unknown>;
    variables?: Record<string, unknown>;
    abilities?: Record<string, unknown>;
    attributeTypes?: Record<string, unknown>;
    map?: Record<string, unknown>;
    settings?: Record<string, unknown>;
    images?: unknown[];
    tilesets?: unknown[];
    sound?: Record<string, unknown>;
    [key: string]: unknown;
  };
  physicsEngine?: string;
  frameRate?: number;
  defaultMaxPlayers?: number;
  mapBackgroundColor?: string;
  [key: string]: unknown;
}

interface OldScript {
  name?: string;
  key?: string;
  actions?: unknown[];
  conditions?: unknown[];
  triggers?: unknown[];
  [key: string]: unknown;
}

export interface MigratedGameData {
  version: string;
  settings: Record<string, unknown>;
  map: Record<string, unknown>;
  entities: {
    unitTypes: Record<string, unknown>;
    itemTypes: Record<string, unknown>;
    projectileTypes: Record<string, unknown>;
    playerTypes: Record<string, unknown>;
  };
  scripts: Record<string, { name: string; triggers: string[]; actions: Array<Record<string, unknown>> }>;
  variables: Record<string, { value: unknown; type: string }>;
  abilities: Record<string, unknown>;
  attributes: Record<string, unknown>;
  assets: {
    images: Array<{ key: string; url: string }>;
    sounds: Array<{ key: string; url: string }>;
    tilesets: Array<{ key: string; url: string }>;
  };
}

export class GameMigrator {
  static migrate(oldData: OldGameData): MigratedGameData {
    const data = oldData.data;

    return {
      version: '2.0',
      settings: GameMigrator._migrateSettings(oldData),
      map: (data.map as Record<string, unknown>) ?? {},
      entities: {
        unitTypes: (data.unitTypes as Record<string, unknown>) ?? {},
        itemTypes: (data.itemTypes as Record<string, unknown>) ?? {},
        projectileTypes: (data.projectileTypes as Record<string, unknown>) ?? {},
        playerTypes: (data.playerTypes as Record<string, unknown>) ?? {},
      },
      scripts: GameMigrator._migrateScripts(data.scripts ?? {}),
      variables: GameMigrator._migrateVariables(data.variables ?? {}),
      abilities: (data.abilities as Record<string, unknown>) ?? {},
      attributes: (data.attributeTypes as Record<string, unknown>) ?? {},
      assets: {
        images: Array.isArray(data.images) ? data.images.map((img: any, i: number) => ({ key: `image_${i}`, url: img.url ?? img })) : [],
        sounds: [],
        tilesets: Array.isArray(data.tilesets) ? data.tilesets.map((ts: any, i: number) => ({ key: `tileset_${i}`, url: ts.image ?? '' })) : [],
      },
    };
  }

  private static _migrateSettings(oldData: OldGameData): Record<string, unknown> {
    return {
      physicsEngine: oldData.physicsEngine ?? 'rapier2d',
      frameRate: oldData.frameRate ?? 60,
      maxPlayers: oldData.defaultMaxPlayers ?? 32,
      mapBackgroundColor: oldData.mapBackgroundColor ?? '#222222',
      ...(oldData.data.settings ?? {}),
    };
  }

  private static _migrateScripts(scripts: Record<string, OldScript>): Record<string, { name: string; triggers: string[]; actions: Array<Record<string, unknown>> }> {
    const result: Record<string, { name: string; triggers: string[]; actions: Array<Record<string, unknown>> }> = {};

    for (const [key, script] of Object.entries(scripts)) {
      const triggers: string[] = [];
      if (Array.isArray(script.triggers)) {
        triggers.push(...script.triggers.map((t: any) => typeof t === 'string' ? t : t.type ?? 'unknown'));
      }

      result[key] = {
        name: script.name ?? key,
        triggers,
        actions: Array.isArray(script.actions) ? script.actions : [],
      };
    }

    return result;
  }

  private static _migrateVariables(variables: Record<string, unknown>): Record<string, { value: unknown; type: string }> {
    const result: Record<string, { value: unknown; type: string }> = {};

    for (const [key, variable] of Object.entries(variables)) {
      if (variable && typeof variable === 'object' && 'dataType' in variable) {
        const v = variable as { dataType?: string; value?: unknown; default?: unknown };
        result[key] = {
          value: v.value ?? v.default ?? null,
          type: v.dataType ?? typeof (v.value ?? v.default ?? ''),
        };
      } else {
        result[key] = {
          value: variable,
          type: typeof variable,
        };
      }
    }

    return result;
  }

  static isV1(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    return 'data' in d && typeof d.data === 'object' && !('version' in d);
  }

  static isV2(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;
    return (data as Record<string, unknown>).version === '2.0';
  }
}
