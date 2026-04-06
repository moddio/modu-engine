import { Entity } from '../ecs/Entity';
import { EventEmitter } from '../events/EventEmitter';

export interface UnitStats {
  name: string;
  type: string;
  health: number;
  maxHealth: number;
  speed: number;
  stateId: string;
  ownerId: string;    // Player ID that owns this unit
  clientId: string;   // Network client ID
  isHidden: boolean;
  opacity: number;
  flip: number;
  scale: number;
  // Body/physics
  currentBody?: Record<string, unknown>;
  bodies?: Record<string, Record<string, unknown>>;
  // Animation
  animations?: Record<string, unknown>;
  states?: Record<string, { body?: string; animation?: string }>;
  // Scripting
  scripts?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  controls?: Record<string, unknown>;
  [key: string]: unknown;
}

const defaultUnitStats: UnitStats = {
  name: '',
  type: '',
  health: 100,
  maxHealth: 100,
  speed: 5,
  stateId: 'default',
  ownerId: '',
  clientId: '',
  isHidden: false,
  opacity: 1,
  flip: 0,
  scale: 1,
};

export class Unit extends Entity {
  stats: UnitStats;
  readonly events = new EventEmitter();

  constructor(id?: string, stats?: Partial<UnitStats>) {
    super(id);
    this.category = 'unit';
    this.stats = { ...defaultUnitStats, ...stats };
  }

  get isDead(): boolean { return this.stats.health <= 0; }

  /** Get the owner player ID */
  get owner(): string { return this.stats.ownerId; }

  takeDamage(amount: number): void {
    this.stats.health = Math.max(0, this.stats.health - amount);
  }

  heal(amount: number): void {
    this.stats.health = Math.min(this.stats.maxHealth, this.stats.health + amount);
  }

  /** Change state, updating body/animation and emitting an event */
  setState(stateId: string): void {
    if (this.stats.stateId === stateId) return;
    const prev = this.stats.stateId;
    this.stats.stateId = stateId;
    this.events.emit('stateChange', { prev, next: stateId });
  }

  /** Set the owner player ID */
  setOwner(playerId: string): void {
    const prev = this.stats.ownerId;
    this.stats.ownerId = playerId;
    if (prev !== playerId) {
      this.events.emit('ownerChange', { prev, next: playerId });
    }
  }

  /** Swap unit type definition, merging new stats */
  changeType(typeDef: Record<string, unknown>): void {
    const prevType = this.stats.type;
    Object.assign(this.stats, typeDef);
    this.events.emit('typeChange', { prev: prevType, next: this.stats.type });
  }
}
