import { describe, it, expect, vi } from 'vitest';
import { MenuUI } from '../../../engine/client/ui/MenuUI';

describe('MenuUI', () => {
  it('starts in loading state', () => {
    const menu = new MenuUI();
    expect(menu.state).toBe('loading');
    expect(menu.visible).toBe(true);
  });

  it('setState updates state and emits stateChange', () => {
    const menu = new MenuUI();
    const fn = vi.fn();
    menu.events.on('stateChange', fn);
    menu.setState('ready');
    expect(menu.state).toBe('ready');
    expect(fn).toHaveBeenCalledWith({ state: 'ready', error: undefined });
  });

  it('setState with error stores error message', () => {
    const menu = new MenuUI();
    const fn = vi.fn();
    menu.events.on('stateChange', fn);
    menu.setState('error', 'Connection failed');
    expect(menu.state).toBe('error');
    expect(menu.errorMessage).toBe('Connection failed');
    expect(fn).toHaveBeenCalledWith({ state: 'error', error: 'Connection failed' });
  });

  it('setServers stores servers and emits serversUpdated', () => {
    const menu = new MenuUI();
    const fn = vi.fn();
    menu.events.on('serversUpdated', fn);
    const servers = [
      { id: 's1', name: 'US East', playerCount: 10, maxPlayers: 50, url: 'ws://us-east' },
    ];
    menu.setServers(servers);
    expect(menu.servers).toEqual(servers);
    expect(fn).toHaveBeenCalledWith({ servers });
  });

  it('show sets visible true and emits', () => {
    const menu = new MenuUI();
    menu.hide();
    const fn = vi.fn();
    menu.events.on('show', fn);
    menu.show();
    expect(menu.visible).toBe(true);
    expect(fn).toHaveBeenCalled();
  });

  it('hide sets visible false and emits', () => {
    const menu = new MenuUI();
    const fn = vi.fn();
    menu.events.on('hide', fn);
    menu.hide();
    expect(menu.visible).toBe(false);
    expect(fn).toHaveBeenCalled();
  });

  it('destroy sets visible false', () => {
    const menu = new MenuUI();
    menu.destroy();
    expect(menu.visible).toBe(false);
  });
});
