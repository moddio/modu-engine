import { describe, it, expect, vi } from 'vitest';
import { DevMode } from '../../../editor/DevMode';

describe('DevMode', () => {
  it('starts inactive', () => {
    expect(new DevMode().active).toBe(false);
  });

  it('enter activates', () => {
    const dm = new DevMode();
    dm.enter();
    expect(dm.active).toBe(true);
  });

  it('leave deactivates and resets tool', () => {
    const dm = new DevMode();
    dm.enter();
    dm.setTool('brush');
    dm.leave();
    expect(dm.active).toBe(false);
    expect(dm.activeTool).toBe('cursor');
  });

  it('setTool changes active tool', () => {
    const dm = new DevMode();
    dm.setTool('fill');
    expect(dm.activeTool).toBe('fill');
  });

  it('emits events', () => {
    const dm = new DevMode();
    const fn = vi.fn();
    dm.events.on('toolChange', fn);
    dm.setTool('eraser');
    expect(fn).toHaveBeenCalledWith('eraser');
  });
});
