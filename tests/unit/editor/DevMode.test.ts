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

  describe('changeTab', () => {
    it('starts with activeTab null', () => {
      expect(new DevMode().activeTab).toBeNull();
    });

    it('changeTab sets activeTab and emits tabChange with from/to', () => {
      const dm = new DevMode();
      const fn = vi.fn();
      dm.events.on('tabChange', fn);
      dm.changeTab('map');
      expect(dm.activeTab).toBe('map');
      expect(fn).toHaveBeenCalledWith({ from: null, to: 'map' });
    });

    it('changeTab to same tab is a no-op', () => {
      const dm = new DevMode();
      dm.changeTab('map');
      const fn = vi.fn();
      dm.events.on('tabChange', fn);
      dm.changeTab('map');
      expect(fn).not.toHaveBeenCalled();
    });

    it('changeTab passes previous tab as from', () => {
      const dm = new DevMode();
      dm.changeTab('map');
      const fn = vi.fn();
      dm.events.on('tabChange', fn);
      dm.changeTab('entities');
      expect(fn).toHaveBeenCalledWith({ from: 'map', to: 'entities' });
    });
  });
});
