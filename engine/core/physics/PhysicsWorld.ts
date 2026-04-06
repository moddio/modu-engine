import RAPIER from '@dimforge/rapier2d-compat';
import { Vec2 } from '../math/Vec2';
import { EventEmitter } from '../events/EventEmitter';
import { PhysicsActionQueue } from './PhysicsActionQueue';
import type { PhysicsAction } from './PhysicsActionQueue';

export interface BodyDef {
  type: 'dynamic' | 'static' | 'kinematic';
  position: Vec2;
  angle?: number;
}

export interface ColliderDef {
  shape: 'box' | 'circle';
  width?: number;   // for box (half-extents)
  height?: number;  // for box (half-extents)
  radius?: number;  // for circle
  isSensor?: boolean;
  friction?: number;
  restitution?: number;
  density?: number;
  category?: number;
  mask?: number;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly events: EventEmitter;
  readonly actionQueue: PhysicsActionQueue;
  private _bodies = new Map<number, RigidBody>();
  private _eventQueue: RAPIER.EventQueue;

  constructor(gravity: Vec2 = new Vec2(0, 0)) {
    this.world = new RAPIER.World(new RAPIER.Vector2(gravity.x, gravity.y));
    this.events = new EventEmitter();
    this.actionQueue = new PhysicsActionQueue();
    this._eventQueue = new RAPIER.EventQueue(true);
  }

  /** Drain and execute all queued physics actions. */
  processQueue(): void {
    const actions = this.actionQueue.drain();
    for (const action of actions) {
      this._executeAction(action);
    }
  }

  private _executeAction(action: PhysicsAction): void {
    switch (action.type) {
      case 'createBody': {
        const def = action.data;
        if (def) this.createBody(def);
        break;
      }
      case 'destroyBody': {
        const body = action.data?.body as RigidBody | undefined;
        if (body) this.destroyBody(body);
        break;
      }
      case 'setLinearVelocity': {
        const body = action.data?.body as RigidBody | undefined;
        const vel = action.data?.velocity as Vec2 | undefined;
        if (body && vel) body.linearVelocity = vel;
        break;
      }
      case 'applyForce': {
        const body = action.data?.body as RigidBody | undefined;
        const force = action.data?.force as Vec2 | undefined;
        if (body && force) body.applyForce(force);
        break;
      }
      case 'applyImpulse': {
        const body = action.data?.body as RigidBody | undefined;
        const impulse = action.data?.impulse as Vec2 | undefined;
        if (body && impulse) body.applyImpulse(impulse);
        break;
      }
      case 'applyTorque': {
        const body = action.data?.body as RigidBody | undefined;
        const torque = action.data?.torque as number | undefined;
        if (body && torque !== undefined) body.raw.addTorque(torque, true);
        break;
      }
      case 'translateTo': {
        const body = action.data?.body as RigidBody | undefined;
        const pos = action.data?.position as Vec2 | undefined;
        if (body && pos) body.position = pos;
        break;
      }
    }
  }

  step(dt: number): void {
    this.processQueue();
    this.world.timestep = dt / 1000;
    this.world.step(this._eventQueue);

    // Process collision events
    this._eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      this.events.emit(started ? 'collisionStart' : 'collisionEnd', [handle1, handle2]);
    });

    this._eventQueue.drainContactForceEvents((_event) => {
      // Could emit contact force events if needed
    });
  }

  createBody(def: BodyDef): RigidBody {
    let bodyDesc: RAPIER.RigidBodyDesc;
    switch (def.type) {
      case 'dynamic': bodyDesc = RAPIER.RigidBodyDesc.dynamic(); break;
      case 'static': bodyDesc = RAPIER.RigidBodyDesc.fixed(); break;
      case 'kinematic': bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased(); break;
    }
    bodyDesc.setTranslation(def.position.x, def.position.y);
    if (def.angle) bodyDesc.setRotation(def.angle);

    const rapierBody = this.world.createRigidBody(bodyDesc);
    const body = new RigidBody(rapierBody, this);
    this._bodies.set(rapierBody.handle, body);
    return body;
  }

  destroyBody(body: RigidBody): void {
    this._bodies.delete(body.handle);
    this.world.removeRigidBody(body.raw);
  }

  getBody(handle: number): RigidBody | undefined {
    return this._bodies.get(handle);
  }

  get bodyCount(): number {
    return this._bodies.size;
  }

  destroy(): void {
    this.world.free();
    this._eventQueue.free();
  }
}

// Import at bottom to avoid circular dependency
import { RigidBody } from './RigidBody';
