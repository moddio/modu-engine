import RAPIER from '@dimforge/rapier3d-compat';
import { Vec3 } from '../math/Vec3';
import { EventEmitter } from '../events/EventEmitter';

export interface BodyDef3d {
  type: 'dynamic' | 'static' | 'kinematic';
  position: Vec3;
  rotation?: { x: number; y: number; z: number; w: number };
}

export interface ColliderDef3d {
  shape: 'box' | 'sphere' | 'capsule';
  halfExtents?: Vec3;  // for box
  radius?: number;      // for sphere and capsule
  /** Capsule only: half the length of the cylindrical section, excluding the end caps. */
  halfHeight?: number;
  isSensor?: boolean;
  /** Collision group bits, same scheme as the 2D path (see CollisionFilter). */
  category?: number;
  mask?: number;
  friction?: number;
  restitution?: number;
  density?: number;
  /** Explicit collider mass, from taro's `fixture.overrideMass` + `fixture.mass`.
   *  Wins over `density`: a 3D fixture routinely ships `density: 0` alongside
   *  `overrideMass: true, mass: 20`, and honouring only the density leaves a massless
   *  dynamic body that no contact can stop. */
  mass?: number;
}

let _initPromise: Promise<void> | null = null;

/**
 * One-time backend initialisation. The rapier build is WASM and has to be compiled
 * before any world can exist. Mirrors `initPhysics` on the 2D path.
 */
export function initPhysics3d(): Promise<void> {
  if (!_initPromise) _initPromise = RAPIER.init();
  return _initPromise;
}

export class PhysicsWorld3d {
  readonly world: RAPIER.World;
  readonly events: EventEmitter;
  private _bodies = new Map<number, RigidBody3d>();
  private _eventQueue: RAPIER.EventQueue;

  constructor(gravity: Vec3 = new Vec3(0, -9.81, 0)) {
    this.world = new RAPIER.World(new RAPIER.Vector3(gravity.x, gravity.y, gravity.z));
    this.events = new EventEmitter();
    this._eventQueue = new RAPIER.EventQueue(true);
  }

  step(dt: number): void {
    this.world.timestep = dt / 1000;
    this.world.step(this._eventQueue);

    // Rapier's `addForce` is persistent — it keeps applying the force every step until
    // `resetForces` is called. Box2D's `applyForce`, which taro and the scripting action
    // `applyForceOnEntityAngle` were calibrated against, is one-shot per step: the force
    // accumulates within a frame, integrates, then clears. Without this reset a script
    // that applies force once accelerates the body toward terminal velocity F/(m·damping)
    // instead of decaying — the 2D world has always done it, and the 3D world inherited
    // the same scripts without the same guarantee.
    for (const body of this._bodies.values()) {
      body.raw.resetForces(false);
    }

    // Process collision events
    this._eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      this.events.emit(started ? 'collisionStart' : 'collisionEnd', [handle1, handle2]);
    });

    this._eventQueue.drainContactForceEvents((_event) => {
      // Could emit contact force events if needed
    });
  }

  createBody(def: BodyDef3d): RigidBody3d {
    let bodyDesc: RAPIER.RigidBodyDesc;
    switch (def.type) {
      case 'dynamic': bodyDesc = RAPIER.RigidBodyDesc.dynamic(); break;
      case 'static': bodyDesc = RAPIER.RigidBodyDesc.fixed(); break;
      case 'kinematic': bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased(); break;
    }
    bodyDesc.setTranslation(def.position.x, def.position.y, def.position.z);
    if (def.rotation) {
      bodyDesc.setRotation(def.rotation);
    }

    const rapierBody = this.world.createRigidBody(bodyDesc);
    const body = new RigidBody3d(rapierBody, this);
    this._bodies.set(rapierBody.handle, body);
    return body;
  }

  destroyBody(body: RigidBody3d): void {
    this._bodies.delete(body.handle);
    this.world.removeRigidBody(body.raw);
  }

  getBody(handle: number): RigidBody3d | undefined {
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
import { RigidBody3d } from './RigidBody3d';
