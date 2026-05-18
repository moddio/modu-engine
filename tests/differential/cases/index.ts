import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Case } from '../types';

export function loadCases(): Case[] {
  const dir = __dirname;
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Case);
}
