import { Entity } from '../ecs/Entity';
import { Vec2 } from '../math/Vec2';

export interface ProjectileStats {
  speed: number;
  damage: number;
  lifetime: number;
  [key: string]: unknown;
}

const defaultProjectileStats: ProjectileStats = {
  speed: 10,
  damage: 10,
  lifetime: 2000,
};

export class Projectile extends Entity {
  stats: ProjectileStats;
  velocity = new Vec2(0, 0);
  elapsed = 0;

  constructor(id?: string, stats?: Partial<ProjectileStats>) {
    super(id);
    this.category = 'projectile';
    this.stats = { ...defaultProjectileStats, ...stats };
  }

  get isExpired(): boolean { return this.elapsed >= this.stats.lifetime; }

  update(dt: number): void {
    if (!this.alive) return;
    super.update(dt);
    this.elapsed += dt;
    if (this.isExpired) {
      this.destroy();
    }
  }
}
