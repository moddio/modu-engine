import { Entity } from '../ecs/Entity';
import { Vec2 } from '../math/Vec2';

export interface ProjectileStats {
  speed: number;
  damage: number;
  lifetime: number;
  sourceUnitId: string;
  sourceItemId: string;
  lifeSpan: number;  // ms — alias kept in sync with lifetime
  [key: string]: unknown;
}

const defaultProjectileStats: ProjectileStats = {
  speed: 10,
  damage: 10,
  lifetime: 2000,
  sourceUnitId: '',
  sourceItemId: '',
  lifeSpan: 2000,
};

export class Projectile extends Entity {
  stats: ProjectileStats;
  velocity = new Vec2(0, 0);
  elapsed = 0;

  constructor(id?: string, stats?: Partial<ProjectileStats>) {
    super(id);
    this.category = 'projectile';
    this.stats = { ...defaultProjectileStats, ...stats };
    // Sync lifeSpan and lifetime — lifeSpan takes priority if explicitly provided
    if (stats?.lifeSpan !== undefined && stats?.lifetime === undefined) {
      this.stats.lifetime = this.stats.lifeSpan;
    } else {
      this.stats.lifeSpan = this.stats.lifetime;
    }
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
