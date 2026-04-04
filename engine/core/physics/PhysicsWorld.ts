import RAPIER from '@dimforge/rapier2d-compat';
import { Vec2 } from '../math/Vec2';
import { EventEmitter } from '../events/EventEmitter';

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
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly events: EventEmitter;
  private _bodies = new Map<number, RigidBody>();
  private _eventQueue: RAPIER.EventQueue;

  constructor(gravity: Vec2 = new Vec2(0, 0)) {
    this.world = new RAPIER.World(new RAPIER.Vector2(gravity.x, gravity.y));
    this.events = new EventEmitter();
    this._eventQueue = new RAPIER.EventQueue(true);
  }

  step(dt: number): void {
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
