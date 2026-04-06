import { describe, it, expect, beforeEach } from 'vitest';
import { VariableStore } from '../../../../engine/core/scripting/VariableStore';

describe('VariableStore', () => {
  let vs: VariableStore;

  beforeEach(() => {
    vs = new VariableStore();
  });

  it('global get/set', () => {
    vs.setGlobal('score', 100);
    expect(vs.getGlobal('score')).toBe(100);
  });

  it('global returns undefined for missing key', () => {
    expect(vs.getGlobal('missing')).toBeUndefined();
  });

  it('entity scoped variables', () => {
    vs.setEntityVar('e1', 'health', 50);
    vs.setEntityVar('e2', 'health', 75);
    expect(vs.getEntityVar('e1', 'health')).toBe(50);
    expect(vs.getEntityVar('e2', 'health')).toBe(75);
  });

  it('entity var returns undefined for missing entity', () => {
    expect(vs.getEntityVar('noEntity', 'x')).toBeUndefined();
  });

  it('player scoped variables', () => {
    vs.setPlayerVar('p1', 'kills', 3);
    expect(vs.getPlayerVar('p1', 'kills')).toBe(3);
  });

  it('player var returns undefined for missing player', () => {
    expect(vs.getPlayerVar('noPlayer', 'x')).toBeUndefined();
  });

  it('loadGlobals from game data format', () => {
    vs.loadGlobals({
      score: { value: 0, type: 'number' },
      name: { value: 'World', type: 'string' },
    });
    expect(vs.getGlobal('score')).toBe(0);
    expect(vs.getGlobal('name')).toBe('World');
  });

  it('removeEntity cleans up', () => {
    vs.setEntityVar('e1', 'x', 10);
    vs.removeEntity('e1');
    expect(vs.getEntityVar('e1', 'x')).toBeUndefined();
  });

  it('removePlayer cleans up', () => {
    vs.setPlayerVar('p1', 'x', 10);
    vs.removePlayer('p1');
    expect(vs.getPlayerVar('p1', 'x')).toBeUndefined();
  });

  it('reset clears everything', () => {
    vs.setGlobal('a', 1);
    vs.setEntityVar('e1', 'b', 2);
    vs.setPlayerVar('p1', 'c', 3);
    vs.reset();

    expect(vs.getGlobal('a')).toBeUndefined();
    expect(vs.getEntityVar('e1', 'b')).toBeUndefined();
    expect(vs.getPlayerVar('p1', 'c')).toBeUndefined();
  });

  it('setGlobal with explicit type', () => {
    vs.setGlobal('count', '5', 'number');
    expect(vs.getGlobal('count')).toBe('5');
  });
});
