import { describe, it, expect } from 'vitest';
import { Unit } from '../../../engine/core/game/Unit';
import { Player } from '../../../engine/core/game/Player';
import { Item } from '../../../engine/core/game/Item';
import { Projectile } from '../../../engine/core/game/Projectile';
import { Prop } from '../../../engine/core/game/Prop';
import { Region } from '../../../engine/core/game/Region';
import { Sensor } from '../../../engine/core/game/Sensor';
import { Rect } from '../../../engine/core/math/Rect';

describe('Unit', () => {
  it('has category unit', () => { expect(new Unit().category).toBe('unit'); });
  it('has default stats', () => {
    const u = new Unit();
    expect(u.stats.health).toBe(100);
    expect(u.stats.maxHealth).toBe(100);
    expect(u.stats.speed).toBe(5);
  });
  it('accepts custom stats', () => { expect(new Unit(undefined, { health: 50 }).stats.health).toBe(50); });
  it('takeDamage reduces health', () => {
    const u = new Unit(); u.takeDamage(30);
    expect(u.stats.health).toBe(70);
  });
  it('takeDamage does not go below 0', () => {
    const u = new Unit(); u.takeDamage(200);
    expect(u.stats.health).toBe(0);
    expect(u.isDead).toBe(true);
  });
  it('heal restores health', () => {
    const u = new Unit(); u.takeDamage(50); u.heal(20);
    expect(u.stats.health).toBe(70);
  });
  it('heal does not exceed max', () => {
    const u = new Unit(); u.takeDamage(10); u.heal(100);
    expect(u.stats.health).toBe(100);
  });
});

describe('Player', () => {
  it('has category player', () => { expect(new Player().category).toBe('player'); });
  it('extends Unit with score', () => {
    const p = new Player();
    expect(p.stats.score).toBe(0);
    expect(p.stats.level).toBe(1);
    expect(p.stats.health).toBe(100);
  });
  it('addScore', () => {
    const p = new Player(); p.addScore(50);
    expect(p.stats.score).toBe(50);
  });
});

describe('Item', () => {
  it('has category item', () => { expect(new Item().category).toBe('item'); });
  it('has default quantity', () => { expect(new Item().stats.quantity).toBe(1); });
  it('consume reduces quantity', () => {
    const i = new Item(undefined, { quantity: 5 }); i.consume(2);
    expect(i.stats.quantity).toBe(3);
  });
  it('consume does not go below 0', () => {
    const i = new Item(undefined, { quantity: 1 }); i.consume(5);
    expect(i.stats.quantity).toBe(0);
    expect(i.isEmpty).toBe(true);
  });
  it('stack adds quantity up to max', () => {
    const i = new Item(undefined, { quantity: 5, maxQuantity: 10 });
    const added = i.stack(8);
    expect(added).toBe(5);
    expect(i.stats.quantity).toBe(10);
  });
});

describe('Projectile', () => {
  it('has category projectile', () => { expect(new Projectile().category).toBe('projectile'); });
  it('expires after lifetime', () => {
    const p = new Projectile(undefined, { lifetime: 100 });
    expect(p.isExpired).toBe(false);
    p.update(50);
    expect(p.isExpired).toBe(false);
    p.update(60);
    expect(p.isExpired).toBe(true);
    expect(p.alive).toBe(false);
  });
});

describe('Prop', () => {
  it('has category prop', () => { expect(new Prop().category).toBe('prop'); });
  it('accepts stats', () => { expect(new Prop(undefined, { name: 'tree' }).stats.name).toBe('tree'); });
});

describe('Region', () => {
  it('has category region', () => { expect(new Region().category).toBe('region'); });
  it('containsPoint', () => {
    const r = new Region(undefined, new Rect(10, 10, 50, 50));
    expect(r.containsPoint(30, 30)).toBe(true);
    expect(r.containsPoint(0, 0)).toBe(false);
  });
  it('default bounds', () => { expect(new Region().bounds.width).toBe(100); });
});

describe('Sensor', () => {
  it('has category sensor', () => { expect(new Sensor().category).toBe('sensor'); });
});
