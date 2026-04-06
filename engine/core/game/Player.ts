import { Unit, UnitStats } from './Unit';

export interface PlayerStats extends UnitStats {
  score: number;
  level: number;
  coins: number;
  controlledBy: 'human' | 'computer';
  unitIds: string[];
  selectedUnitId: string;
  cameraTrackedUnitId: string;
}

const defaultPlayerStats: Partial<PlayerStats> = {
  score: 0,
  level: 1,
  coins: 0,
  controlledBy: 'human',
  unitIds: [],
  selectedUnitId: '',
  cameraTrackedUnitId: '',
};

export class Player extends Unit {
  declare stats: PlayerStats;

  constructor(id?: string, stats?: Partial<PlayerStats>) {
    // Ensure unitIds gets a fresh array per instance
    const merged = { ...defaultPlayerStats, ...stats };
    if (!stats?.unitIds) merged.unitIds = [];
    super(id, merged);
    this.category = 'player';
  }

  addScore(points: number): void {
    this.stats.score += points;
  }

  /** Add a unit ID to this player's owned units */
  addUnit(unitId: string): void {
    if (!this.stats.unitIds.includes(unitId)) {
      this.stats.unitIds.push(unitId);
    }
  }

  /** Remove a unit ID from this player's owned units */
  removeUnit(unitId: string): void {
    const idx = this.stats.unitIds.indexOf(unitId);
    if (idx !== -1) {
      this.stats.unitIds.splice(idx, 1);
    }
    // Clear selection if removed unit was selected
    if (this.stats.selectedUnitId === unitId) {
      this.stats.selectedUnitId = '';
    }
    if (this.stats.cameraTrackedUnitId === unitId) {
      this.stats.cameraTrackedUnitId = '';
    }
  }

  /** Select a unit (must be in unitIds) */
  selectUnit(unitId: string): void {
    this.stats.selectedUnitId = unitId;
  }

  /** Get the currently selected unit ID */
  get selectedUnit(): string {
    return this.stats.selectedUnitId;
  }
}
