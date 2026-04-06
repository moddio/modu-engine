import type { EntityCreatePayload } from './Messages';
import { encodeTransform } from './Messages';

export const MERGE_KEYS = ['attributes', 'attributesMin', 'attributesMax', 'attributesRegenerateRate', 'variables', 'quests'];

export function buildEntityCreatePayload(
  classId: string,
  entityId: string,
  x: number,
  y: number,
  rotation: number,
  stats: Record<string, unknown>,
): EntityCreatePayload {
  return {
    classId,
    entityId,
    transform: encodeTransform({ x, y, rotation }),
    stats,
  };
}

export function mergeStatsUpdate(
  existing: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...existing };
  for (const [key, value] of Object.entries(update)) {
    if (MERGE_KEYS.includes(key) && typeof value === 'object' && value !== null) {
      result[key] = { ...(result[key] as Record<string, unknown> || {}), ...(value as Record<string, unknown>) };
    } else {
      result[key] = value;
    }
  }
  return result;
}
