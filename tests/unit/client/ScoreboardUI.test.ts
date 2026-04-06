import { describe, it, expect, vi } from 'vitest';
import { ScoreboardUI } from '../../../engine/client/ui/ScoreboardUI';

describe('ScoreboardUI', () => {
  it('starts hidden', () => {
    const sb = new ScoreboardUI();
    expect(sb.visible).toBe(false);
    expect(sb.entries).toEqual([]);
  });

  it('update sorts entries by score descending', () => {
    const sb = new ScoreboardUI();
    sb.update([
      { playerId: 'p1', name: 'Alice', score: 50, isCurrentPlayer: false },
      { playerId: 'p2', name: 'Bob', score: 100, isCurrentPlayer: true },
      { playerId: 'p3', name: 'Charlie', score: 75, isCurrentPlayer: false },
    ]);
    expect(sb.entries[0].name).toBe('Bob');
    expect(sb.entries[1].name).toBe('Charlie');
    expect(sb.entries[2].name).toBe('Alice');
  });

  it('update emits updated event', () => {
    const sb = new ScoreboardUI();
    const fn = vi.fn();
    sb.events.on('updated', fn);
    const entries = [
      { playerId: 'p1', name: 'Alice', score: 50, isCurrentPlayer: true },
    ];
    sb.update(entries);
    expect(fn).toHaveBeenCalledWith({ entries: sb.entries });
  });

  it('toggle flips visibility and emits correct event', () => {
    const sb = new ScoreboardUI();
    const showFn = vi.fn();
    const hideFn = vi.fn();
    sb.events.on('show', showFn);
    sb.events.on('hide', hideFn);

    sb.toggle();
    expect(sb.visible).toBe(true);
    expect(showFn).toHaveBeenCalledTimes(1);

    sb.toggle();
    expect(sb.visible).toBe(false);
    expect(hideFn).toHaveBeenCalledTimes(1);
  });

  it('show/hide set visibility and emit events', () => {
    const sb = new ScoreboardUI();
    const showFn = vi.fn();
    const hideFn = vi.fn();
    sb.events.on('show', showFn);
    sb.events.on('hide', hideFn);

    sb.show();
    expect(sb.visible).toBe(true);
    expect(showFn).toHaveBeenCalled();

    sb.hide();
    expect(sb.visible).toBe(false);
    expect(hideFn).toHaveBeenCalled();
  });

  it('setScoreAttribute changes the tracked attribute', () => {
    const sb = new ScoreboardUI();
    expect(sb.scoreAttribute).toBe('score');
    sb.setScoreAttribute('kills');
    expect(sb.scoreAttribute).toBe('kills');
  });

  it('destroy clears entries and hides', () => {
    const sb = new ScoreboardUI();
    sb.update([{ playerId: 'p1', name: 'Alice', score: 10, isCurrentPlayer: false }]);
    sb.show();
    sb.destroy();
    expect(sb.visible).toBe(false);
    expect(sb.entries).toEqual([]);
  });
});
