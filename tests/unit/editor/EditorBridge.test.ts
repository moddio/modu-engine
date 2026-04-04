import { describe, it, expect, vi } from 'vitest';
import { EditorBridgeImpl } from '../../../editor/EditorBridge';

describe('EditorBridge', () => {
  it('starts disconnected', () => {
    const bridge = new EditorBridgeImpl();
    expect(bridge.isConnected).toBe(false);
  });

  it('connects external editor', () => {
    const bridge = new EditorBridgeImpl();
    bridge.connectExternal({ updateEntity: vi.fn(), updateRegion: vi.fn(), editGlobalScripts: vi.fn(), saveMap: vi.fn() });
    expect(bridge.isConnected).toBe(true);
  });

  it('disconnects', () => {
    const bridge = new EditorBridgeImpl();
    bridge.connectExternal({ updateEntity: vi.fn(), updateRegion: vi.fn(), editGlobalScripts: vi.fn(), saveMap: vi.fn() });
    bridge.disconnectExternal();
    expect(bridge.isConnected).toBe(false);
  });

  it('notifies external editor', () => {
    const bridge = new EditorBridgeImpl();
    const ext = { updateEntity: vi.fn(), updateRegion: vi.fn(), editGlobalScripts: vi.fn(), saveMap: vi.fn() };
    bridge.connectExternal(ext);
    bridge.notifyEntityUpdate({ id: 'e1', props: { health: 50 } });
    expect(ext.updateEntity).toHaveBeenCalledWith({ id: 'e1', props: { health: 50 } });
  });

  it('emits events', () => {
    const bridge = new EditorBridgeImpl();
    const fn = vi.fn();
    bridge.events.on('entityUpdate', fn);
    bridge.notifyEntityUpdate({ id: 'e1', props: {} });
    expect(fn).toHaveBeenCalled();
  });

  it('works without external editor', () => {
    const bridge = new EditorBridgeImpl();
    expect(() => bridge.notifyEntityUpdate({ id: 'e1', props: {} })).not.toThrow();
  });
});
