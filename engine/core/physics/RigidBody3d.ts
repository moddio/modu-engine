import RAPIER from '@dimforge/rapier3d-compat';
import { Vec3 } from '../math/Vec3';
import type { PhysicsWorld3d, ColliderDef3d } from './PhysicsWorld3d';

export class RigidBody3d {
  constructor(
    readonly raw: RAPIER.RigidBody,
    private _world: PhysicsWorld3d,
  ) {}

  get handle(): number { return this.raw.handle; }

  get position(): Vec3 {
    const t = this.raw.translation();
    return new Vec3(t.x, t.y, t.z);
  }

  set position(v: Vec3) {
    // Reject a partial vector rather than letting it through. A `{x, y}` literal left
    // over from the 2D API yields z = undefined, rapier stores NaN, and the entity
    // silently disappears — it renders at (NaN, NaN, NaN) and every distance test
    // against it returns false. Failing here names the caller instead.
    if (!Number.isFinite(v?.x) || !Number.isFinite(v?.y) || !Number.isFinite(v?.z)) {
      throw new TypeError(`RigidBody3d.position needs finite x, y and z; got ${JSON.stringify(v)}`);
    }
    this.raw.setTranslation(new RAPIER.Vector3(v.x, v.y, v.z), true);
  }

  get rotation(): { x: number; y: number; z: number; w: number } {
    const r = this.raw.rotation();
    return { x: r.x, y: r.y, z: r.z, w: r.w };
  }

  set rotation(q: { x: number; y: number; z: number; w: number }) {
    this.raw.setRotation(q, true);
  }

  get linearVelocity(): Vec3 {
    const v = this.raw.linvel();
    return new Vec3(v.x, v.y, v.z);
  }

  set linearVelocity(v: Vec3) {
    this.raw.setLinvel(new RAPIER.Vector3(v.x, v.y, v.z), true);
  }

  get angularVelocity(): Vec3 {
    const v = this.raw.angvel();
    return new Vec3(v.x, v.y, v.z);
  }

  set angularVelocity(v: Vec3) {
    this.raw.setAngvel(new RAPIER.Vector3(v.x, v.y, v.z), true);
  }

  get linearDamping(): number { return this.raw.linearDamping(); }
  set linearDamping(v: number) { this.raw.setLinearDamping(v); }

  get angularDamping(): number { return this.raw.angularDamping(); }
  set angularDamping(v: number) { this.raw.setAngularDamping(v); }

  /** Total mass, including every attached collider. */
  get mass(): number { return this.raw.mass(); }

  /**
   * Freeze or release every rotational degree of freedom.
   *
   * Locked is right for anything whose facing is written by game logic — units turn to
   * face the cursor, items point along the swing arc — because physics spin would fight
   * those writes every tick.
   */
  lockRotation(locked: boolean): void {
    this.raw.lockRotations(locked, true);
  }

  /**
   * Lock individual axes. Scenery wants yaw free but pitch and roll pinned: a shoved
   * table should spin on the floor, not tip onto its side. That distinction does not
   * exist in 2D, where there was only ever one rotational axis to lock.
   */
  lockRotationAxes(x: boolean, y: boolean, z: boolean): void {
    this.raw.setEnabledRotations(x, y, z, true);
  }

  applyForce(force: Vec3): void {
    this.raw.addForce(new RAPIER.Vector3(force.x, force.y, force.z), true);
  }

  applyImpulse(impulse: Vec3): void {
    this.raw.applyImpulse(new RAPIER.Vector3(impulse.x, impulse.y, impulse.z), true);
  }

  applyTorque(torque: Vec3): void {
    this.raw.addTorque(new RAPIER.Vector3(torque.x, torque.y, torque.z), true);
  }

  get isSleeping(): boolean { return this.raw.isSleeping(); }

  addCollider(def: ColliderDef3d): RAPIER.Collider {
    let shape: RAPIER.ColliderDesc;
    if (def.shape === 'box') {
      const he = def.halfExtents ?? new Vec3(0.5, 0.5, 0.5);
      shape = RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z);
    } else if (def.shape === 'capsule') {
      // Units are capsules: a box catches its corners on every ledge and doorway, a
      // capsule rides over them. Y-aligned, so the rounded caps are the feet and head.
      shape = RAPIER.ColliderDesc.capsule(def.halfHeight ?? 0.5, def.radius ?? 0.25);
    } else {
      shape = RAPIER.ColliderDesc.ball(def.radius ?? 0.5);
    }
    if (def.isSensor) shape.setSensor(true);
    // rapier packs the pair into one u32: category in the high half, mask in the low.
    if (def.category !== undefined && def.mask !== undefined) {
      shape.setCollisionGroups((def.category << 16) | def.mask);
    }
    if (def.friction !== undefined) shape.setFriction(def.friction);
    if (def.restitution !== undefined) shape.setRestitution(def.restitution);
    if (def.density !== undefined) shape.setDensity(def.density);
    // An explicit mass wins over density, or a `density: 0` fixture yields a massless
    // dynamic body that the contact solver cannot stop. Rapier derives the angular
    // inertia from the shape, so it does not need supplying alongside.
    if (def.mass !== undefined && def.mass > 0) shape.setMass(def.mass);
    shape.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    return this._world.world.createCollider(shape, this.raw);
  }
}
