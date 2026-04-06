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
  it('has taro-style default stats', () => {
    const u = new Unit();
    expect(u.stats.stateId).toBe('default');
    expect(u.stats.ownerId).toBe('');
    expect(u.stats.clientId).toBe('');
    expect(u.stats.isHidden).toBe(false);
    expect(u.stats.opacity).toBe(1);
    expect(u.stats.flip).toBe(0);
    expect(u.stats.scale).toBe(1);
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

  it('setState changes stateId and emits event', () => {
    const u = new Unit();
    let emitted: unknown = null;
    u.events.on('stateChange', (data: unknown) => { emitted = data; });
    u.setState('running');
    expect(u.stats.stateId).toBe('running');
    expect(emitted).toEqual({ prev: 'default', next: 'running' });
  });

  it('setState does not emit if same state', () => {
    const u = new Unit();
    let count = 0;
    u.events.on('stateChange', () => { count++; });
    u.setState('default');
    expect(count).toBe(0);
  });

  it('setOwner changes ownerId and emits event', () => {
    const u = new Unit();
    let emitted: unknown = null;
    u.events.on('ownerChange', (data: unknown) => { emitted = data; });
    u.setOwner('player1');
    expect(u.stats.ownerId).toBe('player1');
    expect(u.owner).toBe('player1');
    expect(emitted).toEqual({ prev: '', next: 'player1' });
  });

  it('setOwner does not emit if same owner', () => {
    const u = new Unit(undefined, { ownerId: 'p1' });
    let count = 0;
    u.events.on('ownerChange', () => { count++; });
    u.setOwner('p1');
    expect(count).toBe(0);
  });

  it('changeType merges new stats and emits event', () => {
    const u = new Unit(undefined, { type: 'warrior' });
    let emitted: unknown = null;
    u.events.on('typeChange', (data: unknown) => { emitted = data; });
    u.changeType({ type: 'mage', speed: 8 });
    expect(u.stats.type).toBe('mage');
    expect(u.stats.speed).toBe(8);
    expect(emitted).toEqual({ prev: 'warrior', next: 'mage' });
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
  it('has new default stats', () => {
    const p = new Player();
    expect(p.stats.coins).toBe(0);
    expect(p.stats.controlledBy).toBe('human');
    expect(p.stats.unitIds).toEqual([]);
    expect(p.stats.selectedUnitId).toBe('');
    expect(p.stats.cameraTrackedUnitId).toBe('');
  });
  it('addScore', () => {
    const p = new Player(); p.addScore(50);
    expect(p.stats.score).toBe(50);
  });
  it('addUnit adds unique unit IDs', () => {
    const p = new Player();
    p.addUnit('u1');
    p.addUnit('u2');
    p.addUnit('u1'); // duplicate
    expect(p.stats.unitIds).toEqual(['u1', 'u2']);
  });
  it('removeUnit removes and clears selection', () => {
    const p = new Player();
    p.addUnit('u1');
    p.addUnit('u2');
    p.selectUnit('u1');
    p.removeUnit('u1');
    expect(p.stats.unitIds).toEqual(['u2']);
    expect(p.stats.selectedUnitId).toBe('');
  });
  it('removeUnit clears cameraTrackedUnitId', () => {
    const p = new Player();
    p.addUnit('u1');
    p.stats.cameraTrackedUnitId = 'u1';
    p.removeUnit('u1');
    expect(p.stats.cameraTrackedUnitId).toBe('');
  });
  it('selectUnit and selectedUnit getter', () => {
    const p = new Player();
    p.selectUnit('u5');
    expect(p.selectedUnit).toBe('u5');
  });
  it('each player instance gets its own unitIds array', () => {
    const p1 = new Player();
    const p2 = new Player();
    p1.addUnit('u1');
    expect(p2.stats.unitIds).toEqual([]);
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
  it('has source tracking defaults', () => {
    const p = new Projectile();
    expect(p.stats.sourceUnitId).toBe('');
    expect(p.stats.sourceItemId).toBe('');
  });
  it('tracks source unit and item', () => {
    const p = new Projectile(undefined, { sourceUnitId: 'u1', sourceItemId: 'i1' });
    expect(p.stats.sourceUnitId).toBe('u1');
    expect(p.stats.sourceItemId).toBe('i1');
  });
  it('lifeSpan syncs with lifetime', () => {
    const p = new Projectile(undefined, { lifetime: 500 });
    expect(p.stats.lifeSpan).toBe(500);
  });
  it('lifeSpan takes priority when set explicitly', () => {
    const p = new Projectile(undefined, { lifeSpan: 300 });
    expect(p.stats.lifetime).toBe(300);
    expect(p.isExpired).toBe(false);
    p.update(300);
    expect(p.isExpired).toBe(true);
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
