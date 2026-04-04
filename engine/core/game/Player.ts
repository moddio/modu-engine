import { Unit, UnitStats } from './Unit';

export interface PlayerStats extends UnitStats {
  score: number;
  level: number;
}

const defaultPlayerStats: Partial<PlayerStats> = {
  score: 0,
  level: 1,
};

export class Player extends Unit {
  declare stats: PlayerStats;

  constructor(id?: string, stats?: Partial<PlayerStats>) {
    super(id, { ...defaultPlayerStats, ...stats });
    this.category = 'player';
  }

  addScore(points: number): void {
    this.stats.score += points;
  }
}
