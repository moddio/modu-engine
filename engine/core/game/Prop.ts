import { Entity } from '../ecs/Entity';

export interface PropStats {
  name: string;
  type: string;
  [key: string]: unknown;
}

export class Prop extends Entity {
  stats: PropStats;

  constructor(id?: string, stats?: Partial<PropStats>) {
    super(id);
    this.category = 'prop';
    this.stats = { name: '', type: '', ...stats };
  }
}
