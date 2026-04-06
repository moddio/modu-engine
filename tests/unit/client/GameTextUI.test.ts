import { describe, it, expect, vi } from 'vitest';
import { GameTextUI } from '../../../engine/client/ui/GameText';

describe('GameTextUI', () => {
  it('starts visible with no notifications', () => {
    const gt = new GameTextUI();
    expect(gt.visible).toBe(true);
    expect(gt.notifications).toEqual([]);
  });

  it('show creates notification with unique id and emits', () => {
    const gt = new GameTextUI();
    const fn = vi.fn();
    gt.events.on('notification', fn);
    const id1 = gt.show('Hello');
    const id2 = gt.show('World', 'warning', 5000);
    expect(id1).not.toBe(id2);
    expect(gt.notifications.length).toBe(2);
    expect(gt.notifications[0].text).toBe('Hello');
    expect(gt.notifications[0].type).toBe('info');
    expect(gt.notifications[1].type).toBe('warning');
    expect(gt.notifications[1].duration).toBe(5000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('remove filters out notification by id', () => {
    const gt = new GameTextUI();
    const id = gt.show('test');
    gt.show('keep');
    gt.remove(id);
    expect(gt.notifications.length).toBe(1);
    expect(gt.notifications[0].text).toBe('keep');
  });

  it('update removes expired notifications', () => {
    const gt = new GameTextUI();
    const fn = vi.fn();
    gt.events.on('updated', fn);

    // Manually create notifications with controlled createdAt
    gt.show('short', 'info', 1000);
    gt.show('long', 'info', 5000);

    // Override createdAt for testing
    gt.notifications[0].createdAt = 1000;
    gt.notifications[1].createdAt = 1000;

    // At time 1500, both alive
    gt.update(1500);
    expect(gt.notifications.length).toBe(2);
    expect(fn).not.toHaveBeenCalled();

    // At time 2500, short expired
    gt.update(2500);
    expect(gt.notifications.length).toBe(1);
    expect(gt.notifications[0].text).toBe('long');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('update does not emit if nothing expired', () => {
    const gt = new GameTextUI();
    const fn = vi.fn();
    gt.events.on('updated', fn);
    gt.show('test', 'info', 10000);
    gt.update(Date.now());
    expect(fn).not.toHaveBeenCalled();
  });

  it('hide sets visible false', () => {
    const gt = new GameTextUI();
    gt.hide();
    expect(gt.visible).toBe(false);
  });

  it('destroy clears all notifications', () => {
    const gt = new GameTextUI();
    gt.show('a');
    gt.show('b');
    gt.destroy();
    expect(gt.notifications).toEqual([]);
  });
});
