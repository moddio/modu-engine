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

  applyForce(force: Vec2): void {
    this.raw.addForce(new RAPIER.Vector2(force.x, force.y), true);
  }

  applyImpulse(impulse: Vec2): void {
    this.raw.applyImpulse(new RAPIER.Vector2(impulse.x, impulse.y), true);
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
