import { describe, it, expect } from 'vitest';
import { AbilityManager } from '../../../engine/core/game/Ability';

describe('AbilityManager', () => {
  it('register and activate', () => {
    const am = new AbilityManager();
    am.register({ name: 'fireball', cooldown: 1000, duration: 0 });
    expect(am.activate('fireball')).toBe(true);
  });

  it('cooldown prevents re-activation', () => {
    const am = new AbilityManager();
    am.register({ name: 'fireball', cooldown: 1000, duration: 0 });
    am.activate('fireball');
    expect(am.isOnCooldown('fireball')).toBe(true);
    expect(am.activate('fireball')).toBe(false);
  });

  it('cooldown expires over time', () => {
    const am = new AbilityManager();
    am.register({ name: 'fireball', cooldown: 1000, duration: 0 });
    am.activate('fireball');
    am.update(500);
    expect(am.isOnCooldown('fireball')).toBe(true);
    am.update(600);
    expect(am.isOnCooldown('fireball')).toBe(false);
    expect(am.activate('fireball')).toBe(true);
  });

  it('duration-based ability', () => {
    const am = new AbilityManager();
    am.register({ name: 'shield', cooldown: 5000, duration: 2000 });
    am.activate('shield');
    expect(am.isActive('shield')).toBe(true);
    am.update(1000);
    expect(am.isActive('shield')).toBe(true);
    am.update(1500);
    expect(am.isActive('shield')).toBe(false);
  });

  it('unknown ability returns false', () => {
    const am = new AbilityManager();
    expect(am.activate('nonexistent')).toBe(false);
  });
});
