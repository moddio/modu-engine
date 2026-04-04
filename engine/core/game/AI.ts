import { Component } from '../ecs/Component';
import { Vec2 } from '../math/Vec2';

export type AIState = 'idle' | 'patrol' | 'chase' | 'attack' | 'flee';

export class AIComponent extends Component {
  static readonly id = 'ai';
  state: AIState = 'idle';
  target: Vec2 | null = null;
  sightRange = 200;
  attackRange = 30;
}
