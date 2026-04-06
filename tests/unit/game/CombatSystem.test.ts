import { describe, it, expect } from 'vitest';
import { CombatSystem } from '../../../engine/core/game/CombatSystem';
import { Unit } from '../../../engine/core/game/Unit';
import { Entity } from '../../../engine/core/ecs/Entity';

describe('CombatSystem', () => {
  it('applyDamage reduces health and returns dealt amount', () => {
    const cs = new CombatSystem();
    const u = new Unit(undefined, { health: 100, maxHealth: 100 });
    const dealt = cs.applyDamage(u, 30, 'attacker1');
    expect(dealt).toBe(30);
    expect(u.stats.health).toBe(70);
  });

  it('applyDamage clamps to zero', () => {
    const cs = new CombatSystem();
    const u = new Unit(undefined, { health: 20, maxHealth: 100 });
    const dealt = cs.applyDamage(u, 50);
    expect(dealt).toBe(20);
    expect(u.stats.health).toBe(0);
  });

  it('applyDamage emits damage event', () => {
    const cs = new CombatSystem();
    const u = new Unit('target1', { health: 100, maxHealth: 100 });
    let emitted: any = null;
    cs.events.on('damage', (data: unknown) => { emitted = data; });
    cs.applyDamage(u, 25, 'src1');
    expect(emitted).toEqual({ targetId: 'target1', sourceId: 'src1', amount: 25 });
  });

  it('applyDamage emits death event when health reaches 0', () => {
    const cs = new CombatSystem();
    const u = new Unit('target2', { health: 10, maxHealth: 100 });
    let deathEvent: any = null;
    cs.events.on('death', (data: unknown) => { deathEvent = data; });
    cs.applyDamage(u, 10, 'killer');
    expect(deathEvent).toEqual({ targetId: 'target2', sourceId: 'killer' });
  });

  it('applyDamage does not emit death if still alive', () => {
    const cs = new CombatSystem();
    const u = new Unit(undefined, { health: 100, maxHealth: 100 });
    let died = false;
    cs.events.on('death', () => { died = true; });
    cs.applyDamage(u, 50);
    expect(died).toBe(false);
  });

  it('applyDamage returns 0 for entity without stats', () => {
    const cs = new CombatSystem();
    const e = new Entity();
    expect(cs.applyDamage(e, 10)).toBe(0);
  });

  it('applyHeal restores health up to maxHealth', () => {
    const cs = new CombatSystem();
    const u = new Unit(undefined, { health: 50, maxHealth: 100 });
    const healed = cs.applyHeal(u, 30);
    expect(healed).toBe(30);
    expect(u.stats.health).toBe(80);
  });

  it('applyHeal does not exceed maxHealth', () => {
    const cs = new CombatSystem();
    const u = new Unit(undefined, { health: 90, maxHealth: 100 });
    const healed = cs.applyHeal(u, 50);
    expect(healed).toBe(10);
    expect(u.stats.health).toBe(100);
  });

  it('applyHeal returns 0 for entity without stats', () => {
    const cs = new CombatSystem();
    const e = new Entity();
    expect(cs.applyHeal(e, 10)).toBe(0);
  });

  it('update does not throw', () => {
    const cs = new CombatSystem();
    expect(() => cs.update(16, [])).not.toThrow();
  });
});
