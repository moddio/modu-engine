export type PhysicsActionType =
  | 'createBody'
  | 'destroyBody'
  | 'setLinearVelocity'
  | 'applyForce'
  | 'applyImpulse'
  | 'applyTorque'
  | 'translateTo';

export interface PhysicsAction {
  type: PhysicsActionType;
  entityId: string;
  data?: any;
}

export class PhysicsActionQueue {
  private _queue: PhysicsAction[] = [];

  enqueue(action: PhysicsAction): void {
    this._queue.push(action);
  }

  get length(): number { return this._queue.length; }

  drain(): PhysicsAction[] {
    const actions = this._queue;
    this._queue = [];
    return actions;
  }

  clear(): void {
    this._queue = [];
  }
}
