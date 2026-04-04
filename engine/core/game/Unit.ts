import { Entity } from '../ecs/Entity';

export interface UnitStats {
  name: string;
  type: string;
  health: number;
  maxHealth: number;
  speed: number;
  [key: string]: unknown;
}

const defaultUnitStats: UnitStats = {
  name: '',
  type: '',
  health: 100,
  maxHealth: 100,
  speed: 5,
};

export class Unit extends Entity {
  stats: UnitStats;

  constructor(id?: string, stats?: Partial<UnitStats>) {
    super(id);
    this.category = 'unit';
    this.stats = { ...defaultUnitStats, ...stats };
  }

  get isDead(): boolean { return this.stats.health <= 0; }

  takeDamage(amount: number): void {
    this.stats.health = Math.max(0, this.stats.health - amount);
  }

  heal(amount: number): void {
    this.stats.health = Math.min(this.stats.maxHealth, this.stats.health + amount);
  }
}
