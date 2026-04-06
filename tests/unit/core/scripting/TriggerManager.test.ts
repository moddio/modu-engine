import { describe, it, expect, beforeEach } from 'vitest';
import { TriggerManager } from '../../../../engine/core/scripting/TriggerManager';
import type { ScriptDef } from '../../../../engine/core/GameLoader';

describe('TriggerManager', () => {
  let tm: TriggerManager;

  beforeEach(() => {
    tm = new TriggerManager();
  });

  it('load() builds trigger-to-script index', () => {
    const scripts: Record<string, ScriptDef> = {
      s1: { name: 'Script1', triggers: ['gameStart'], actions: [] },
      s2: { name: 'Script2', triggers: ['unitTouchesWall'], actions: [] },
    };
    tm.load(scripts);

    expect(tm.scriptCount).toBe(2);
    expect(tm.triggerCount).toBe(2);
  });

  it('getScriptsForTrigger returns correct script IDs', () => {
    const scripts: Record<string, ScriptDef> = {
      s1: { name: 'Script1', triggers: ['gameStart'], actions: [] },
    };
    tm.load(scripts);

    expect(tm.getScriptsForTrigger('gameStart')).toEqual(['s1']);
  });

  it('multiple scripts for same trigger', () => {
    const scripts: Record<string, ScriptDef> = {
      s1: { name: 'Script1', triggers: ['gameStart'], actions: [] },
      s2: { name: 'Script2', triggers: ['gameStart'], actions: [] },
    };
    tm.load(scripts);

    expect(tm.getScriptsForTrigger('gameStart')).toEqual(['s1', 's2']);
  });

  it('returns empty array for unknown triggers', () => {
    tm.load({});
    expect(tm.getScriptsForTrigger('nonExistent')).toEqual([]);
  });

  it('getScript retrieves by ID', () => {
    const scripts: Record<string, ScriptDef> = {
      s1: { name: 'Script1', triggers: ['gameStart'], actions: [{ type: 'comment' }] },
    };
    tm.load(scripts);

    const script = tm.getScript('s1');
    expect(script).not.toBeNull();
    expect(script!.name).toBe('Script1');
    expect(script!.actions).toHaveLength(1);
  });

  it('getScript returns null for unknown ID', () => {
    tm.load({});
    expect(tm.getScript('unknown')).toBeNull();
  });

  it('script with multiple triggers indexes all triggers', () => {
    const scripts: Record<string, ScriptDef> = {
      s1: { name: 'Multi', triggers: ['gameStart', 'gameEnd'], actions: [] },
    };
    tm.load(scripts);

    expect(tm.getScriptsForTrigger('gameStart')).toEqual(['s1']);
    expect(tm.getScriptsForTrigger('gameEnd')).toEqual(['s1']);
    expect(tm.triggerCount).toBe(2);
  });

  it('load() clears previous data', () => {
    tm.load({ s1: { name: 'A', triggers: ['foo'], actions: [] } });
    tm.load({ s2: { name: 'B', triggers: ['bar'], actions: [] } });

    expect(tm.scriptCount).toBe(1);
    expect(tm.getScriptsForTrigger('foo')).toEqual([]);
    expect(tm.getScriptsForTrigger('bar')).toEqual(['s2']);
  });
});
