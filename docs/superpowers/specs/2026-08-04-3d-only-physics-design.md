# 3D-only physics: GameServer on rapier3d

**Date:** 2026-08-04
**Status:** approved design, not yet planned
**Scope:** the engine's physics layer only. The tile map stays as-is for now.

## Problem

A unit cannot stand on a car, a crate, or a bed. It shoves them instead.

The simulation is `rapier2d` and has no vertical axis. Jump is not simulated at all: the
server emits a `jumpEntity` UI command (`GameServer.ts:421`) and the renderer fakes a Y
bounce (`GameRenderer.triggerJump`, `JUMP_GRAVITY = 30`). The collider never leaves the
plane, so a jumping unit keeps colliding with a prop's footprint the whole way up and
across. `encodeTransform` sends `{x, y, rotation}` — there is no `z` on the wire, so even a
correct 3D simulation would be invisible to the client.

## Decision

The engine deals only with 3D from here. `rapier2d` is deleted outright. Games with
`defaultRenderer: '2d'` are no longer supported by modu and remain on legacy taro.

This was chosen with the catalogue cost known and accepted:

| games (DB census, 2026-08-04) | count |
|---|---|
| total | 402,636 |
| `defaultRenderer: '3d'` | 61,901 |
| `defaultRenderer: '2d'` | 52,506 |
| unset (play page defaults to `'2d'`) | 288,229 |
| published | 141,149 |
| published **and** 3d | 35,207 |

Roughly three in four published games are 2D or default to it — about 106,000 titles. They
stay on taro. Braains.io and Booty are unaffected: neither references the engine, they use
the moddio SDK (auth and player data), which is a different package.

## What already exists

| Asset | State |
|---|---|
| `@dimforge/rapier3d-compat` | already a declared dependency |
| `PhysicsWorld3d` (85 ln) | gravity `(0,−9.81,0)`, box/sphere colliders, collision events |
| `RigidBody3d` (79 ln) | position, quaternion, linear/angular velocity, force/impulse/torque |
| unit tests | ~170 ln across `PhysicsWorld3d.test.ts` / `RigidBody3d.test.ts`, passing |
| `settings.physicsEngine` | exists in `GameMigrator`, defaults `'rapier2d'`, **never read** |
| unit fixtures | already 3D: `shape{width,height,depth}` × `scale.z = 1.88` (a survivor stands 1.88 tiles) |

`GameServer` references `PhysicsWorld3d` / `RigidBody3d` zero times. The backend selector
was stubbed and never wired. This work finishes that intent rather than inventing it.

## Coupling to remove

`GameServer` is 4,037 lines with roughly 75 direct uses of the 2D API: 17 `new Vec2`,
14 `linearVelocity`, 13 `_tileToPhysics`, 5 `body.angle`, 26 `_entityBodies`. The 2D core
being deleted is 330 lines (`PhysicsWorld` 175, `RigidBody` 104, `MapPhysics` 51).

## Components

### 0. Bake prop heights — blocker

**37 of 38 prop types carry no Z extent** (`scale.z === 1`; several have no `shape.depth`).
Only *Double Bed* has one. Without heights every prop is a uniform ~1-tile box: a police car
and a bed would hold a unit at the same altitude, and the collider would not match the model
on screen.

glTF stores per-accessor `min`/`max`, so a bounding box is readable from the GLB's JSON
chunk with no mesh decoding. Verified against this game's assets: **48 of 48 GLBs expose
usable `POSITION` min/max** (table `3.00 × 1.00 × 2.00`, lamp `1.00 × 2.52 × 1.00`, Y is
height).

A tool walks `propTypes`, measures each GLB, and writes `shape.depth` / `scale.z`, where
`heightTiles = bbox.y × baseScale` using the same `baseScale` the renderer already derives
from the body footprint. Physics then agrees with the rendered model by construction.

Authoring heights in the editor is the correct long-term home, but it lives outside this
repo and must not gate this work.

### 1. `RigidBody3d` parity

Add what `GameServer` actually uses and the 3D wrapper lacks: `linearDamping`,
`angularDamping`, `mass`, `lockRotation` (per-axis in 3D), collision groups.

`CollisionFilter` (34 ln) is reused **unchanged** — its category and mask bits are plain
rapier collision groups, identical in 2D and 3D. No 3D twin is needed.

### 2. `MapPhysics3d`

Walls become cuboids instead of flat boxes. Height comes from the stacked wall layers:
`walls`, `walls2`, `walls3` and `walls4` occupy an identical set of 408 cells with distinct
tile ids per layer (36 / 45 / 45 / 43), which is a four-storey wall on one footprint.

Note the irony and accept it for now: the multi-layer map that is slated for deletion is
precisely what supplies wall height in this phase. When the map rewrite lands, wall geometry
moves to whatever that produces, and this module is rewritten once.

### 3. `GameServer` on 3D

- `Vec2` → `Vec3` throughout; positions become real `(x, y, z)` rather than `(x, y)`
  flattened to `(x, z)`.
- Scalar `body.angle` → quaternion. Yaw extraction replaces the physics-angle↔render-yaw
  negation added on 2026-08-04, since a quaternion carries the frame directly.
- Gravity owns the vertical axis. Horizontal movement is unchanged in feel.
- `_applyGroundFriction` is **deleted**. Real normal forces plus rapier's own friction
  replace the hand-rolled Coulomb budget.
- Jump becomes a real impulse. The `jumpEntity` UI command path is removed.

### 4. Protocol

Transforms carry `z`. With 2D gone there is no fallback path, so `z` is a required field of
the transform schema rather than an optional one. Separately — and this is about *which
entities appear in a snapshot*, not about the field — an entity that has not moved since the
last snapshot should be omitted from the transform list entirely. 69 props at 20 Hz already
dominate this game's snapshot traffic, and all but a handful of them are motionless.

### 5. Renderer

Read the streamed `z`. Delete `triggerJump` and its `JUMP_GRAVITY` bounce. Reconcile
`_entityFloorY` and the `_worldY` placement hint against real height — both exist only
because the server previously had no height to send.

### 6. Delete the 2D backend

Remove `PhysicsWorld.ts`, `RigidBody.ts`, `MapPhysics.ts`, the `@dimforge/rapier2d-compat`
dependency, and the stubbed `settings.physicsEngine` field.

## Testing

The 35-case `PhysicsConformance` suite is written against 2D and dies with the backend. It is
replaced by a 3D suite that ports the cases which still carry meaning — mass, damping,
friction, collision response, determinism, coordinate contract — and adds the behaviours that
only exist once there is a vertical axis:

- a unit lands on a crate and stays on it
- a unit walks off an edge and falls
- crates settle when dropped rather than jittering
- a shoved prop does not launch (restitution and damping sanity)
- a unit cannot walk through a wall at any height below the wall's top

## Decisions taken

- **Units are capsules, not boxes.** A box catches its corners on every ledge; a capsule
  rides over them. This governs how jumping onto a car feels.
- **Props collide with each other but are not required to stack cleanly.** Reliable stacking
  is a much higher solver-tuning bar and nothing in this game needs a crate tower.
- **The tile map stays.** Replacing it is a separate project and must not be entangled here.

## Non-goals

- Replacing the multi-layer or voxel map (separate project; wall geometry is re-derived then).
- AI-assisted map generation (separate project, and the one that defines the future world model).
- Migrating any 2D game to 3D.
- Editor changes.

## Risks

1. **Movement feel changes.** Ground friction is replaced by real friction. Braains3D's
   current tuning — a shoved prop stopping in ~1 s over 0.32 tiles — will need re-tuning
   against the new model. The conformance suite pins behaviour, not identical numbers.
2. **Baked heights may be wrong for models whose origin is not at the base.** A GLB whose
   mesh straddles `y = 0` yields a correct *height* but the wrong *resting offset*, so the
   prop sits half-buried or floating. The bake therefore records `bbox.min.y` and
   `bbox.max.y` separately rather than only their difference, so the offset is derivable and
   an off-origin model shows up in review instead of failing silently.
3. **Snapshot growth.** Adding `z` to every transform costs bandwidth in a game already
   streaming 69 props; omitting it for static entities is part of the work, not an
   optimisation to defer.
4. **One-way door.** Deleting `rapier2d` ends 2D support in modu for good. Accepted above.

## Superseded work

The ground-friction model committed earlier today (`95b83c9`) is replaced by real physics in
this design. Its companion fix (`81b9545`, physics-angle↔render-yaw handedness) survives in
spirit as quaternion yaw extraction. Today's friction tuning was a stopgap and should be
understood as such.
