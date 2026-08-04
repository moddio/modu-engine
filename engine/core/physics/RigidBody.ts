import RAPIER from '@dimforge/rapier2d-compat';
import { Vec2 } from '../math/Vec2';
import type { PhysicsWorld, ColliderDef } from './PhysicsWorld';

export class RigidBody {
  constructor(
    readonly raw: RAPIER.RigidBody,
    private _world: PhysicsWorld,
  ) {}

  get handle(): number { return this.raw.handle; }

  get position(): Vec2 {
    const t = this.raw.translation();
    return new Vec2(t.x, t.y);
  }

  set position(v: Vec2) {
    this.raw.setTranslation(new RAPIER.Vector2(v.x, v.y), true);
  }

  get angle(): number { return this.raw.rotation(); }
  set angle(rad: number) { this.raw.setRotation(rad, true); }

  get linearVelocity(): Vec2 {
    const v = this.raw.linvel();
    return new Vec2(v.x, v.y);
  }

  set linearVelocity(v: Vec2) {
    this.raw.setLinvel(new RAPIER.Vector2(v.x, v.y), true);
  }

  get angularVelocity(): number { return this.raw.angvel(); }
  set angularVelocity(v: number) { this.raw.setAngvel(v, true); }

  get linearDamping(): number { return this.raw.linearDamping(); }
  set linearDamping(v: number) { this.raw.setLinearDamping(v); }

  get angularDamping(): number { return this.raw.angularDamping(); }
  set angularDamping(v: number) { this.raw.setAngularDamping(v); }

  /** Total mass, including every attached collider. */
  get mass(): number { return this.raw.mass(); }

  /**
   * Freeze or release the body's rotational degree of freedom.
   *
   * Locked is the right default for anything whose facing is written by game logic
   * (units turn to face the cursor, items point along the swing arc) — physics spin
   * would fight those writes every tick. Physical scenery is the opposite case: a
   * shoved sofa has to be able to turn, so props are created unlocked.
   */
  lockRotation(locked: boolean): void {
    this.raw.lockRotations(locked, true);
  }

  applyForce(force: Vec2): void {
    this.raw.addForce(new RAPIER.Vector2(force.x, force.y), true);
  }

  applyImpulse(impulse: Vec2): void {
    this.raw.applyImpulse(new RAPIER.Vector2(impulse.x, impulse.y), true);
  }

  applyTorque(torque: number): void {
    this.raw.addTorque(torque, true);
  }

  get isSleeping(): boolean { return this.raw.isSleeping(); }

  addCollider(def: ColliderDef): RAPIER.Collider {
    let shape: RAPIER.ColliderDesc;
    if (def.shape === 'box') {
      shape = RAPIER.ColliderDesc.cuboid(def.width ?? 0.5, def.height ?? 0.5);
    } else {
      shape = RAPIER.ColliderDesc.ball(def.radius ?? 0.5);
    }
    if (def.isSensor) shape.setSensor(true);
    if (def.friction !== undefined) shape.setFriction(def.friction);
    if (def.restitution !== undefined) shape.setRestitution(def.restitution);
    if (def.density !== undefined) shape.setDensity(def.density);
    // An explicit mass wins over density. Rapier derives mass from density*area, so a
    // fixture with density 0 yields a massless dynamic body that no contact can stop.
    //
    // Angular inertia does not need to be supplied alongside it: rapier derives it from
    // the shape, and measures identical to the textbook m·(hw² + hh²)/3 for a cuboid.
    // A backend that does *not* do this (Box2D's `b2MassData` wants the inertia filled
    // in explicitly) has to compute it here, or every mass-overridden prop — which is
    // all of them in a 3D export — ends up unable to spin. PhysicsConformance's
    // "spins an explicit-mass body the way the torque points" is the guard for that.
    if (def.mass !== undefined && def.mass > 0) shape.setMass(def.mass);
    shape.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    // Set collision groups: Rapier packs mask in upper 16 bits, category in lower 16 bits
    if (def.category !== undefined || def.mask !== undefined) {
      const category = (def.category ?? 0xFFFF) & 0xFFFF;
      const mask = (def.mask ?? 0xFFFF) & 0xFFFF;
      shape.setCollisionGroups((mask << 16) | category);
    }

    return this._world.world.createCollider(shape, this.raw);
  }
}
