import { describe, it, expect, vi } from 'vitest';
import { UIManager } from '../../../engine/client/ui/UIManager';
import { MenuUI } from '../../../engine/client/ui/MenuUI';
import { ShopUI } from '../../../engine/client/ui/ShopUI';
import { ScoreboardUI } from '../../../engine/client/ui/ScoreboardUI';
import { DevConsole } from '../../../engine/client/ui/DevConsole';
import { GameText } from '../../../engine/client/ui/GameText';

describe('UIManager', () => {
  it('registers and retrieves components', () => {
    const mgr = new UIManager();
    const menu = new MenuUI();
    mgr.register(menu);
    expect(mgr.get('menu')).toBe(menu);
    expect(mgr.componentCount).toBe(1);
  });

  it('show/hide components', () => {
    const mgr = new UIManager();
    const menu = new MenuUI();
    mgr.register(menu);
    mgr.show('menu');
    expect(menu.visible).toBe(true);
    mgr.hide('menu');
    expect(menu.visible).toBe(false);
  });

  it('hideAll hides everything', () => {
    const mgr = new UIManager();
    const menu = new MenuUI();
    const shop = new ShopUI();
    mgr.register(menu);
    mgr.register(shop);
    mgr.show('menu');
    mgr.show('shop');
    mgr.hideAll();
    expect(menu.visible).toBe(false);
    expect(shop.visible).toBe(false);
  });

  it('unregister destroys and removes', () => {
    const mgr = new UIManager();
    mgr.register(new MenuUI());
    mgr.unregister('menu');
    expect(mgr.get('menu')).toBeUndefined();
    expect(mgr.componentCount).toBe(0);
  });

  it('emits show/hide events', () => {
    const mgr = new UIManager();
    mgr.register(new MenuUI());
    const fn = vi.fn();
    mgr.events.on('show', fn);
    mgr.show('menu');
    expect(fn).toHaveBeenCalledWith('menu');
  });
});

describe('ShopUI', () => {
  it('sets items and emits purchase', () => {
    const shop = new ShopUI();
    const purchaseFn = vi.fn();
    shop.events.on('purchase', purchaseFn);
    shop.setItems([{ id: 'sword', name: 'Sword', cost: 100 }]);
    expect(shop.items.length).toBe(1);
    shop.purchase('sword');
    expect(purchaseFn).toHaveBeenCalledWith({ id: 'sword', name: 'Sword', cost: 100 });
  });
});

describe('ScoreboardUI', () => {
  it('sorts entries by score descending', () => {
    const sb = new ScoreboardUI();
    sb.update([
      { playerId: 'p1', name: 'Alice', score: 50, isCurrentPlayer: false },
      { playerId: 'p2', name: 'Bob', score: 100, isCurrentPlayer: true },
    ]);
    expect(sb.entries[0].name).toBe('Bob');
    expect(sb.entries[1].name).toBe('Alice');
  });
});

describe('DevConsole', () => {
  it('logs messages', () => {
    const dc = new DevConsole(5);
    dc.log('hello');
    dc.warn('warning');
    dc.error('error');
    expect(dc.messages.length).toBe(3);
    expect(dc.messages[0].type).toBe('log');
  });

  it('respects max messages', () => {
    const dc = new DevConsole(3);
    dc.log('1'); dc.log('2'); dc.log('3'); dc.log('4');
    expect(dc.messages.length).toBe(3);
    expect(dc.messages[0].text).toBe('2');
  });

  it('clear empties messages', () => {
    const dc = new DevConsole();
    dc.log('test');
    dc.clear();
    expect(dc.messages.length).toBe(0);
  });
});

describe('GameText', () => {
  it('creates notifications with unique ids', () => {
    const gt = new GameText();
    const id1 = gt.notify('Hello');
    const id2 = gt.notify('World');
    expect(id1).not.toBe(id2);
    expect(gt.notifications.length).toBe(2);
  });

  it('clear removes all', () => {
    const gt = new GameText();
    gt.notify('test');
    gt.clear();
    expect(gt.notifications.length).toBe(0);
  });
});
