import { describe, it, expect, vi } from 'vitest';
import { CommandController } from '../../../engine/client/renderer/tilemap/CommandController';

describe('CommandController', () => {
  it('executes func on addCommand by default', () => {
    const cc = new CommandController();
    const func = vi.fn();
    cc.addCommand({ func, undo: () => {} });
    expect(func).toHaveBeenCalledOnce();
  });

  it('does not execute when execute=false', () => {
    const cc = new CommandController();
    const func = vi.fn();
    cc.addCommand({ func, undo: () => {} }, false);
    expect(func).not.toHaveBeenCalled();
  });

  it('undo walks the pointer and invokes undo()', () => {
    const cc = new CommandController();
    const undo = vi.fn();
    cc.addCommand({ func: () => {}, undo });
    cc.undo();
    expect(undo).toHaveBeenCalledOnce();
  });

  it('redo replays func() after undo', () => {
    const cc = new CommandController();
    const func = vi.fn();
    cc.addCommand({ func, undo: () => {} });
    cc.undo();
    cc.redo();
    expect(func).toHaveBeenCalledTimes(2); // once on add, once on redo
  });

  it('undo/redo no-ops when stack is empty / at either end', () => {
    const cc = new CommandController();
    expect(() => cc.undo()).not.toThrow();
    expect(() => cc.redo()).not.toThrow();
  });

  it('addCommand after undo truncates the redo tail', () => {
    const cc = new CommandController();
    const undo1 = vi.fn();
    const undo2 = vi.fn();
    const undo3 = vi.fn();
    cc.addCommand({ func: () => {}, undo: undo1 });
    cc.addCommand({ func: () => {}, undo: undo2 });
    cc.undo();
    cc.undo();
    cc.addCommand({ func: () => {}, undo: undo3 });
    // Only the fresh command should be on the stack.
    expect(cc.commands.length).toBe(1);
    cc.undo();
    expect(undo3).toHaveBeenCalledOnce();
  });

  it('exposes defaultCommands', () => {
    const inc = vi.fn();
    const cc = new CommandController({ increaseBrushSize: inc });
    cc.defaultCommands.increaseBrushSize();
    expect(inc).toHaveBeenCalledOnce();
  });
});
