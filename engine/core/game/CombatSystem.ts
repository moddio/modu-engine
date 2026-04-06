import { System } from '../ecs/System';
import { Entity } from '../ecs/Entity';
import { EventEmitter } from '../events/EventEmitter';

export class CombatSystem extends System {
  readonly name = 'combat';
  readonly events = new EventEmitter();

  /** Apply damage from source to target. Returns actual damage dealt. */
  applyDamage(target: Entity, amount: number, sourceId?: string): number {
    const stats = (target as any).stats;
    if (!stats || stats.health === undefined) return 0;

    const prevHealth = stats.health;
    stats.health = Math.max(0, stats.health - amount);
    const dealt = prevHealth - stats.health;

    this.events.emit('damage', { targetId: target.id, sourceId, amount: dealt });

    if (stats.health <= 0) {
      this.events.emit('death', { targetId: target.id, sourceId });
    }

    return dealt;
  }

  /** Heal a target. Returns actual healing done. */
  applyHeal(target: Entity, amount: number): number {
    const stats = (target as any).stats;
    if (!stats || stats.health === undefined) return 0;

    const prevHealth = stats.health;
    stats.health = Math.min(stats.maxHealth ?? Infinity, stats.health + amount);
    return stats.health - prevHealth;
  }

  update(_dt: number, _entities: Entity[]): void {
    // Combat is event-driven, not tick-based
  }
}
