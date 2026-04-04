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
    } else {
      shape = RAPIER.ColliderDesc.ball(def.radius ?? 0.5);
    }
    if (def.isSensor) shape.setSensor(true);
    if (def.friction !== undefined) shape.setFriction(def.friction);
    if (def.restitution !== undefined) shape.setRestitution(def.restitution);
    if (def.density !== undefined) shape.setDensity(def.density);
    shape.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    return this._world.world.createCollider(shape, this.raw);
  }
}
