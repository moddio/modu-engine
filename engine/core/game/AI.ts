import { Component } from '../ecs/Component';
import { Vec2 } from '../math/Vec2';

export type AIState = 'idle' | 'patrol' | 'chase' | 'attack' | 'flee' | 'wander';

export interface AIConfig {
  sightRange: number;
  attackRange: number;
  patrolPath?: Vec2[];
  maxIdleTime?: number;  // ms
}

export class AIComponent extends Component {
  static readonly id = 'ai';
  state: AIState = 'idle';
  target: Vec2 | null = null;
  targetEntityId: string | null = null;
  config: AIConfig;
  private _stateTime = 0;

  constructor(config?: Partial<AIConfig>) {
    super();
    this.config = {
      sightRange: config?.sightRange ?? 200,
      attackRange: config?.attackRange ?? 30,
      patrolPath: config?.patrolPath,
      maxIdleTime: config?.maxIdleTime ?? 3000,
    };
  }

  get sightRange(): number { return this.config.sightRange; }
  get attackRange(): number { return this.config.attackRange; }
  get stateTime(): number { return this._stateTime; }

  setState(newState: AIState): void {
    if (this.state !== newState) {
      this.state = newState;
      this._stateTime = 0;
    }
  }

  update(dt: number): void {
    this._stateTime += dt;
  }
}
