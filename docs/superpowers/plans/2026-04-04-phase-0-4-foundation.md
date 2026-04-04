# Modu Engine Foundation (Phases 0-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the project from scratch and build the foundational layers: math library, event system, entity-component system, clock, and game loop.

**Architecture:** ES Module TypeScript codebase built with Vite (client) and tsc (server). Vitest for testing. All code in `engine/core/` is isomorphic (no DOM, no Node-specific APIs). TDD throughout — tests before implementation.

**Tech Stack:** TypeScript 5.x, Vite 6.x, Vitest 3.x, Node 20+

**Reference codebase:** The old engine lives at `/app/data/home/moddio2`. Read it for behavioral reference but never import from it.

---

## File Structure

### Phase 0 — Project Setup
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.client.json`
- Create: `tsconfig.server.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`

### Phase 1 — Math Library
- Create: `engine/core/math/Vec2.ts`
- Create: `engine/core/math/Vec3.ts`
- Create: `engine/core/math/Matrix2d.ts`
- Create: `engine/core/math/Rect.ts`
- Create: `engine/core/math/Polygon.ts`
- Create: `engine/core/math/index.ts`
- Test: `tests/unit/math/Vec2.test.ts`
- Test: `tests/unit/math/Vec3.test.ts`
- Test: `tests/unit/math/Matrix2d.test.ts`
- Test: `tests/unit/math/Rect.test.ts`
- Test: `tests/unit/math/Polygon.test.ts`

### Phase 2 — Event System
- Create: `engine/core/events/EventEmitter.ts`
- Create: `engine/core/events/index.ts`
- Test: `tests/unit/events/EventEmitter.test.ts`

### Phase 3 — Entity-Component System
- Create: `engine/core/ecs/Component.ts`
- Create: `engine/core/ecs/Entity.ts`
- Create: `engine/core/ecs/System.ts`
- Create: `engine/core/ecs/index.ts`
- Test: `tests/unit/ecs/Component.test.ts`
- Test: `tests/unit/ecs/Entity.test.ts`
- Test: `tests/unit/ecs/System.test.ts`

### Phase 4 — Clock & Game Loop
- Create: `engine/core/time/Clock.ts`
- Create: `engine/core/time/index.ts`
- Create: `engine/core/Engine.ts`
- Create: `engine/core/index.ts`
- Test: `tests/unit/time/Clock.test.ts`
- Test: `tests/unit/core/Engine.test.ts`

---

## Task 1: Project Scaffolding (Phase 0)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.client.json`
- Create: `tsconfig.server.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "modu-engine",
  "version": "0.1.0",
  "description": "Modu Engine — a modern multiplayer game engine",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:multi": "concurrently \"vite\" \"tsx watch engine/server/Server.ts\"",
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build",
    "build:server": "tsc -p tsconfig.server.json",
    "test": "vitest",
    "test:run": "vitest run",
    "bench": "vitest bench"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0",
    "tsx": "^4.19.0",
    "concurrently": "^9.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Create base tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": ".",
    "baseUrl": ".",
    "paths": {
      "modu-engine": ["./engine/core/index.ts"],
      "modu-engine/*": ["./engine/*"]
    }
  },
  "include": ["engine/**/*.ts", "editor/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create tsconfig.client.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "outDir": "dist/client"
  },
  "include": ["engine/core/**/*.ts", "engine/client/**/*.ts", "editor/**/*.ts"]
}
```

- [ ] **Step 4: Create tsconfig.server.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "outDir": "dist/server"
  },
  "include": ["engine/core/**/*.ts", "engine/server/**/*.ts"]
}
```

- [ ] **Step 5: Create vite.config.ts**

```ts
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'engine/client/Client.ts'),
      name: 'ModuEngine',
      fileName: 'modu',
    },
    outDir: 'dist/client',
  },
  resolve: {
    alias: {
      'modu-engine': resolve(__dirname, 'engine/core/index.ts'),
    },
  },
});
```

- [ ] **Step 6: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    benchmark: {
      include: ['tests/**/*.bench.ts'],
    },
  },
  resolve: {
    alias: {
      'modu-engine': resolve(__dirname, 'engine/core/index.ts'),
    },
  },
});
```

- [ ] **Step 7: Create .gitignore**

```
node_modules/
dist/
*.js.map
.DS_Store
```

- [ ] **Step 8: Install dependencies and verify**

Run: `cd ~/modu-engine && npm install`
Expected: Clean install, `node_modules/` created, no errors.

- [ ] **Step 9: Create placeholder entry to verify build**

Create `engine/core/index.ts`:
```ts
export const VERSION = '0.1.0';
```

Create `tests/unit/setup.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { VERSION } from '../../engine/core/index';

describe('Project setup', () => {
  it('exports engine version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 10: Run tests to verify setup**

Run: `cd ~/modu-engine && npx vitest run`
Expected: 1 test passing.

- [ ] **Step 11: Commit**

```bash
cd ~/modu-engine
git add -A
git commit -m "feat: project scaffolding with Vite, Vitest, TypeScript"
```

---

## Task 2: Vec2 (Phase 1)

**Files:**
- Create: `engine/core/math/Vec2.ts`
- Test: `tests/unit/math/Vec2.test.ts`

**Reference:** `/app/data/home/moddio2/engine/core/TaroPoint2d.js`

The old TaroPoint2d has a `this*` prefix convention for in-place mutation. In the new API we use a cleaner pattern: methods return new vectors by default; an `_mut` suffix or a separate `set` method mutates in place. We drop isometric conversion methods (that's a renderer concern, not math), drop canvas rendering, and drop the `floor` mode (callers can floor explicitly).

- [ ] **Step 1: Write failing Vec2 tests**

```ts
// tests/unit/math/Vec2.test.ts
import { describe, it, expect } from 'vitest';
import { Vec2 } from '../../../engine/core/math/Vec2';

describe('Vec2', () => {
  describe('construction', () => {
    it('defaults to (0, 0)', () => {
      const v = new Vec2();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
    });

    it('accepts x and y', () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
  });

  describe('arithmetic (immutable)', () => {
    it('add returns new vector', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const c = a.add(b);
      expect(c.x).toBe(4);
      expect(c.y).toBe(6);
      expect(a.x).toBe(1); // original unchanged
    });

    it('sub returns new vector', () => {
      const a = new Vec2(5, 7);
      const b = new Vec2(2, 3);
      const c = a.sub(b);
      expect(c.x).toBe(3);
      expect(c.y).toBe(4);
    });

    it('mul returns new vector (scalar)', () => {
      const v = new Vec2(3, 4);
      const r = v.mul(2);
      expect(r.x).toBe(6);
      expect(r.y).toBe(8);
    });

    it('mul returns new vector (per-axis)', () => {
      const a = new Vec2(3, 4);
      const b = new Vec2(2, 3);
      const r = a.mul(b);
      expect(r.x).toBe(6);
      expect(r.y).toBe(12);
    });

    it('div returns new vector (scalar)', () => {
      const v = new Vec2(6, 8);
      const r = v.div(2);
      expect(r.x).toBe(3);
      expect(r.y).toBe(4);
    });

    it('div returns new vector (per-axis)', () => {
      const a = new Vec2(6, 8);
      const b = new Vec2(2, 4);
      const r = a.div(b);
      expect(r.x).toBe(3);
      expect(r.y).toBe(2);
    });
  });

  describe('operations', () => {
    it('length computes magnitude', () => {
      const v = new Vec2(3, 4);
      expect(v.length()).toBe(5);
    });

    it('lengthSquared avoids sqrt', () => {
      const v = new Vec2(3, 4);
      expect(v.lengthSquared()).toBe(25);
    });

    it('normalize returns unit vector', () => {
      const v = new Vec2(3, 4).normalize();
      expect(v.x).toBeCloseTo(0.6);
      expect(v.y).toBeCloseTo(0.8);
      expect(v.length()).toBeCloseTo(1);
    });

    it('normalize zero vector returns zero', () => {
      const v = new Vec2(0, 0).normalize();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
    });

    it('dot product', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.dot(b)).toBe(11);
    });

    it('cross product (2D scalar)', () => {
      const a = new Vec2(1, 0);
      const b = new Vec2(0, 1);
      expect(a.cross(b)).toBe(1);
    });

    it('distance between two vectors', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(3, 4);
      expect(a.distanceTo(b)).toBe(5);
    });

    it('rotate by radians', () => {
      const v = new Vec2(1, 0);
      const r = v.rotate(Math.PI / 2);
      expect(r.x).toBeCloseTo(0);
      expect(r.y).toBeCloseTo(1);
    });

    it('lerp interpolates', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 20);
      const r = a.lerp(b, 0.5);
      expect(r.x).toBe(5);
      expect(r.y).toBe(10);
    });

    it('clone returns independent copy', () => {
      const a = new Vec2(1, 2);
      const b = a.clone();
      expect(b.x).toBe(1);
      expect(b.y).toBe(2);
      expect(b).not.toBe(a);
    });

    it('equals compares values', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(1, 2);
      const c = new Vec2(1, 3);
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });
  });

  describe('mutation', () => {
    it('set mutates in place', () => {
      const v = new Vec2(1, 2);
      v.set(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });

    it('copy mutates from another vec', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      a.copy(b);
      expect(a.x).toBe(3);
      expect(a.y).toBe(4);
    });
  });

  describe('toString', () => {
    it('formats with default precision', () => {
      const v = new Vec2(1.23456, 7.89012);
      expect(v.toString()).toBe('(1.23, 7.89)');
    });
  });

  describe('static factories', () => {
    it('Vec2.zero()', () => {
      const v = Vec2.zero();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
    });

    it('Vec2.one()', () => {
      const v = Vec2.one();
      expect(v.x).toBe(1);
      expect(v.y).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/modu-engine && npx vitest run tests/unit/math/Vec2.test.ts`
Expected: FAIL — module `Vec2` does not exist.

- [ ] **Step 3: Implement Vec2**

```ts
// engine/core/math/Vec2.ts
export class Vec2 {
  constructor(
    public x: number = 0,
    public y: number = 0,
  ) {}

  // --- Immutable operations (return new Vec2) ---

  add(other: Vec2): Vec2 {
    return new Vec2(this.x + other.x, this.y + other.y);
  }

  sub(other: Vec2): Vec2 {
    return new Vec2(this.x - other.x, this.y - other.y);
  }

  mul(arg: number | Vec2): Vec2 {
    if (typeof arg === 'number') {
      return new Vec2(this.x * arg, this.y * arg);
    }
    return new Vec2(this.x * arg.x, this.y * arg.y);
  }

  div(arg: number | Vec2): Vec2 {
    if (typeof arg === 'number') {
      return new Vec2(this.x / arg, this.y / arg);
    }
    return new Vec2(this.x / arg.x, this.y / arg.y);
  }

  rotate(radians: number): Vec2 {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return new Vec2(
      cos * this.x - sin * this.y,
      sin * this.x + cos * this.y,
    );
  }

  normalize(): Vec2 {
    const len = this.length();
    if (len === 0) return new Vec2(0, 0);
    return new Vec2(this.x / len, this.y / len);
  }

  lerp(target: Vec2, t: number): Vec2 {
    return new Vec2(
      this.x + (target.x - this.x) * t,
      this.y + (target.y - this.y) * t,
    );
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  // --- Scalar results ---

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  lengthSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  dot(other: Vec2): number {
    return this.x * other.x + this.y * other.y;
  }

  cross(other: Vec2): number {
    return this.x * other.y - this.y * other.x;
  }

  distanceTo(other: Vec2): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  equals(other: Vec2): boolean {
    return this.x === other.x && this.y === other.y;
  }

  // --- Mutation ---

  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  copy(other: Vec2): this {
    this.x = other.x;
    this.y = other.y;
    return this;
  }

  // --- Formatting ---

  toString(precision: number = 2): string {
    return `(${this.x.toFixed(precision)}, ${this.y.toFixed(precision)})`;
  }

  // --- Static factories ---

  static zero(): Vec2 {
    return new Vec2(0, 0);
  }

  static one(): Vec2 {
    return new Vec2(1, 1);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/modu-engine && npx vitest run tests/unit/math/Vec2.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/modu-engine
git add engine/core/math/Vec2.ts tests/unit/math/Vec2.test.ts
git commit -m "feat: add Vec2 math class with full test coverage"
```

---

## Task 3: Vec3 (Phase 1)

**Files:**
- Create: `engine/core/math/Vec3.ts`
- Test: `tests/unit/math/Vec3.test.ts`

**Reference:** `/app/data/home/moddio2/engine/core/TaroPoint3d.js`

Same pattern as Vec2 but with z component. Drop isometric conversion. Add cross product that returns Vec3 (proper 3D cross).

- [ ] **Step 1: Write failing Vec3 tests**

```ts
// tests/unit/math/Vec3.test.ts
import { describe, it, expect } from 'vitest';
import { Vec3 } from '../../../engine/core/math/Vec3';

describe('Vec3', () => {
  describe('construction', () => {
    it('defaults to (0, 0, 0)', () => {
      const v = new Vec3();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
      expect(v.z).toBe(0);
    });

    it('accepts x, y, z', () => {
      const v = new Vec3(1, 2, 3);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(3);
    });
  });

  describe('arithmetic (immutable)', () => {
    it('add returns new vector', () => {
      const a = new Vec3(1, 2, 3);
      const b = new Vec3(4, 5, 6);
      const c = a.add(b);
      expect(c.x).toBe(5);
      expect(c.y).toBe(7);
      expect(c.z).toBe(9);
      expect(a.x).toBe(1);
    });

    it('sub returns new vector', () => {
      const c = new Vec3(5, 7, 9).sub(new Vec3(1, 2, 3));
      expect(c.x).toBe(4);
      expect(c.y).toBe(5);
      expect(c.z).toBe(6);
    });

    it('mul scalar', () => {
      const r = new Vec3(1, 2, 3).mul(2);
      expect(r.x).toBe(2);
      expect(r.y).toBe(4);
      expect(r.z).toBe(6);
    });

    it('mul per-axis', () => {
      const r = new Vec3(1, 2, 3).mul(new Vec3(2, 3, 4));
      expect(r.x).toBe(2);
      expect(r.y).toBe(6);
      expect(r.z).toBe(12);
    });

    it('div scalar', () => {
      const r = new Vec3(2, 4, 6).div(2);
      expect(r.x).toBe(1);
      expect(r.y).toBe(2);
      expect(r.z).toBe(3);
    });

    it('div per-axis', () => {
      const r = new Vec3(6, 8, 10).div(new Vec3(2, 4, 5));
      expect(r.x).toBe(3);
      expect(r.y).toBe(2);
      expect(r.z).toBe(2);
    });
  });

  describe('operations', () => {
    it('length', () => {
      const v = new Vec3(2, 3, 6);
      expect(v.length()).toBe(7);
    });

    it('lengthSquared', () => {
      const v = new Vec3(2, 3, 6);
      expect(v.lengthSquared()).toBe(49);
    });

    it('normalize', () => {
      const v = new Vec3(0, 0, 5).normalize();
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(0);
      expect(v.z).toBeCloseTo(1);
    });

    it('normalize zero returns zero', () => {
      const v = new Vec3(0, 0, 0).normalize();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
      expect(v.z).toBe(0);
    });

    it('dot product', () => {
      const a = new Vec3(1, 2, 3);
      const b = new Vec3(4, 5, 6);
      expect(a.dot(b)).toBe(32);
    });

    it('cross product', () => {
      const a = new Vec3(1, 0, 0);
      const b = new Vec3(0, 1, 0);
      const c = a.cross(b);
      expect(c.x).toBe(0);
      expect(c.y).toBe(0);
      expect(c.z).toBe(1);
    });

    it('distanceTo', () => {
      const a = new Vec3(0, 0, 0);
      const b = new Vec3(2, 3, 6);
      expect(a.distanceTo(b)).toBe(7);
    });

    it('lerp', () => {
      const a = new Vec3(0, 0, 0);
      const b = new Vec3(10, 20, 30);
      const r = a.lerp(b, 0.5);
      expect(r.x).toBe(5);
      expect(r.y).toBe(10);
      expect(r.z).toBe(15);
    });

    it('rotateZ rotates around z-axis', () => {
      const v = new Vec3(1, 0, 5);
      const r = v.rotateZ(Math.PI / 2);
      expect(r.x).toBeCloseTo(0);
      expect(r.y).toBeCloseTo(1);
      expect(r.z).toBe(5);
    });

    it('clone returns independent copy', () => {
      const a = new Vec3(1, 2, 3);
      const b = a.clone();
      expect(b.equals(a)).toBe(true);
      expect(b).not.toBe(a);
    });

    it('equals', () => {
      expect(new Vec3(1, 2, 3).equals(new Vec3(1, 2, 3))).toBe(true);
      expect(new Vec3(1, 2, 3).equals(new Vec3(1, 2, 4))).toBe(false);
    });
  });

  describe('mutation', () => {
    it('set mutates in place', () => {
      const v = new Vec3();
      v.set(1, 2, 3);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
      expect(v.z).toBe(3);
    });

    it('copy mutates from another vec', () => {
      const a = new Vec3();
      a.copy(new Vec3(4, 5, 6));
      expect(a.x).toBe(4);
      expect(a.y).toBe(5);
      expect(a.z).toBe(6);
    });
  });

  describe('static factories', () => {
    it('Vec3.zero()', () => {
      expect(Vec3.zero().equals(new Vec3(0, 0, 0))).toBe(true);
    });

    it('Vec3.one()', () => {
      expect(Vec3.one().equals(new Vec3(1, 1, 1))).toBe(true);
    });

    it('Vec3.up()', () => {
      expect(Vec3.up().equals(new Vec3(0, 1, 0))).toBe(true);
    });
  });

  describe('toString', () => {
    it('formats with default precision', () => {
      expect(new Vec3(1.5, 2.5, 3.5).toString()).toBe('(1.50, 2.50, 3.50)');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/modu-engine && npx vitest run tests/unit/math/Vec3.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Vec3**

```ts
// engine/core/math/Vec3.ts
export class Vec3 {
  constructor(
    public x: number = 0,
    public y: number = 0,
    public z: number = 0,
  ) {}

  add(other: Vec3): Vec3 {
    return new Vec3(this.x + other.x, this.y + other.y, this.z + other.z);
  }

  sub(other: Vec3): Vec3 {
    return new Vec3(this.x - other.x, this.y - other.y, this.z - other.z);
  }

  mul(arg: number | Vec3): Vec3 {
    if (typeof arg === 'number') {
      return new Vec3(this.x * arg, this.y * arg, this.z * arg);
    }
    return new Vec3(this.x * arg.x, this.y * arg.y, this.z * arg.z);
  }

  div(arg: number | Vec3): Vec3 {
    if (typeof arg === 'number') {
      return new Vec3(this.x / arg, this.y / arg, this.z / arg);
    }
    return new Vec3(this.x / arg.x, this.y / arg.y, this.z / arg.z);
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  normalize(): Vec3 {
    const len = this.length();
    if (len === 0) return new Vec3(0, 0, 0);
    return new Vec3(this.x / len, this.y / len, this.z / len);
  }

  dot(other: Vec3): number {
    return this.x * other.x + this.y * other.y + this.z * other.z;
  }

  cross(other: Vec3): Vec3 {
    return new Vec3(
      this.y * other.z - this.z * other.y,
      this.z * other.x - this.x * other.z,
      this.x * other.y - this.y * other.x,
    );
  }

  distanceTo(other: Vec3): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    const dz = this.z - other.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  lerp(target: Vec3, t: number): Vec3 {
    return new Vec3(
      this.x + (target.x - this.x) * t,
      this.y + (target.y - this.y) * t,
      this.z + (target.z - this.z) * t,
    );
  }

  rotateZ(radians: number): Vec3 {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return new Vec3(
      cos * this.x - sin * this.y,
      sin * this.x + cos * this.y,
      this.z,
    );
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  equals(other: Vec3): boolean {
    return this.x === other.x && this.y === other.y && this.z === other.z;
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(other: Vec3): this {
    this.x = other.x;
    this.y = other.y;
    this.z = other.z;
    return this;
  }

  toString(precision: number = 2): string {
    return `(${this.x.toFixed(precision)}, ${this.y.toFixed(precision)}, ${this.z.toFixed(precision)})`;
  }

  static zero(): Vec3 { return new Vec3(0, 0, 0); }
  static one(): Vec3 { return new Vec3(1, 1, 1); }
  static up(): Vec3 { return new Vec3(0, 1, 0); }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/modu-engine && npx vitest run tests/unit/math/Vec3.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/modu-engine
git add engine/core/math/Vec3.ts tests/unit/math/Vec3.test.ts
git commit -m "feat: add Vec3 math class with full test coverage"
```

---

## Task 4: Matrix2d (Phase 1)

**Files:**
- Create: `engine/core/math/Matrix2d.ts`
- Test: `tests/unit/math/Matrix2d.test.ts`

**Reference:** `/app/data/home/moddio2/engine/core/TaroMatrix2d.js`

3x3 affine transformation matrix stored as flat array. Drop canvas rendering methods. Keep: identity, translate, rotate, scale, multiply, inverse, transformPoint.

- [ ] **Step 1: Write failing Matrix2d tests**

```ts
// tests/unit/math/Matrix2d.test.ts
import { describe, it, expect } from 'vitest';
import { Matrix2d } from '../../../engine/core/math/Matrix2d';
import { Vec2 } from '../../../engine/core/math/Vec2';

describe('Matrix2d', () => {
  describe('construction', () => {
    it('defaults to identity', () => {
      const m = new Matrix2d();
      expect(m.values).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    });
  });

  describe('identity', () => {
    it('resets to identity', () => {
      const m = new Matrix2d();
      m.translateBy(10, 20);
      m.identity();
      expect(m.values).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    });
  });

  describe('translation', () => {
    it('translateBy applies translation', () => {
      const m = new Matrix2d();
      m.translateBy(10, 20);
      const p = m.transformPoint(new Vec2(0, 0));
      expect(p.x).toBeCloseTo(10);
      expect(p.y).toBeCloseTo(20);
    });

    it('translateTo sets translation directly', () => {
      const m = new Matrix2d();
      m.translateBy(100, 200);
      m.translateTo(5, 10);
      const p = m.transformPoint(new Vec2(0, 0));
      expect(p.x).toBeCloseTo(5);
      expect(p.y).toBeCloseTo(10);
    });
  });

  describe('rotation', () => {
    it('rotateBy rotates a point', () => {
      const m = new Matrix2d();
      m.rotateBy(Math.PI / 2);
      const p = m.transformPoint(new Vec2(1, 0));
      expect(p.x).toBeCloseTo(0);
      expect(p.y).toBeCloseTo(1);
    });

    it('rotateTo sets rotation directly', () => {
      const m = new Matrix2d();
      m.rotateTo(Math.PI / 2);
      const p = m.transformPoint(new Vec2(1, 0));
      expect(p.x).toBeCloseTo(0);
      expect(p.y).toBeCloseTo(1);
    });
  });

  describe('scaling', () => {
    it('scaleBy scales a point', () => {
      const m = new Matrix2d();
      m.scaleBy(2, 3);
      const p = m.transformPoint(new Vec2(4, 5));
      expect(p.x).toBeCloseTo(8);
      expect(p.y).toBeCloseTo(15);
    });

    it('scaleTo sets scale directly', () => {
      const m = new Matrix2d();
      m.scaleTo(2, 3);
      const p = m.transformPoint(new Vec2(4, 5));
      expect(p.x).toBeCloseTo(8);
      expect(p.y).toBeCloseTo(15);
    });
  });

  describe('multiply', () => {
    it('multiplies two matrices', () => {
      const a = new Matrix2d();
      a.translateBy(10, 0);
      const b = new Matrix2d();
      b.translateBy(0, 20);
      a.multiply(b);
      const p = a.transformPoint(new Vec2(0, 0));
      expect(p.x).toBeCloseTo(10);
      expect(p.y).toBeCloseTo(20);
    });
  });

  describe('inverse', () => {
    it('returns inverse matrix', () => {
      const m = new Matrix2d();
      m.translateBy(10, 20);
      m.rotateBy(Math.PI / 4);
      const inv = m.getInverse();
      expect(inv).not.toBeNull();
      // Applying m then inv should get back to original point
      const p = new Vec2(5, 7);
      const transformed = m.transformPoint(p);
      const back = inv!.transformPoint(transformed);
      expect(back.x).toBeCloseTo(5);
      expect(back.y).toBeCloseTo(7);
    });

    it('returns null for singular matrix', () => {
      const m = new Matrix2d();
      m.scaleTo(0, 0);
      expect(m.getInverse()).toBeNull();
    });
  });

  describe('copy and compare', () => {
    it('copy duplicates matrix', () => {
      const a = new Matrix2d();
      a.translateBy(5, 10);
      const b = new Matrix2d();
      b.copy(a);
      expect(b.values).toEqual(a.values);
    });

    it('compare checks equality', () => {
      const a = new Matrix2d();
      const b = new Matrix2d();
      expect(a.compare(b)).toBe(true);
      a.translateBy(1, 0);
      expect(a.compare(b)).toBe(false);
    });
  });

  describe('clone', () => {
    it('returns independent copy', () => {
      const a = new Matrix2d();
      a.translateBy(5, 10);
      const b = a.clone();
      expect(b.values).toEqual(a.values);
      expect(b).not.toBe(a);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/modu-engine && npx vitest run tests/unit/math/Matrix2d.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Matrix2d**

```ts
// engine/core/math/Matrix2d.ts
import { Vec2 } from './Vec2';

export class Matrix2d {
  values: number[];

  constructor() {
    this.values = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }

  identity(): this {
    const v = this.values;
    v[0] = 1; v[1] = 0; v[2] = 0;
    v[3] = 0; v[4] = 1; v[5] = 0;
    v[6] = 0; v[7] = 0; v[8] = 1;
    return this;
  }

  translateBy(x: number, y: number): this {
    const v = this.values;
    v[2] += x;
    v[5] += y;
    return this;
  }

  translateTo(x: number, y: number): this {
    this.values[2] = x;
    this.values[5] = y;
    return this;
  }

  rotateBy(angle: number): this {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const v = this.values;
    const a = v[0], b = v[1];
    const c = v[3], d = v[4];
    v[0] = a * cos + b * sin;
    v[1] = a * -sin + b * cos;
    v[3] = c * cos + d * sin;
    v[4] = c * -sin + d * cos;
    return this;
  }

  rotateTo(angle: number): this {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const v = this.values;
    v[0] = cos;  v[1] = -sin;
    v[3] = sin;  v[4] = cos;
    return this;
  }

  scaleBy(x: number, y: number): this {
    const v = this.values;
    v[0] *= x;
    v[1] *= y;
    v[3] *= x;
    v[4] *= y;
    return this;
  }

  scaleTo(x: number, y: number): this {
    this.identity();
    this.values[0] = x;
    this.values[4] = y;
    return this;
  }

  multiply(other: Matrix2d): this {
    const a = this.values;
    const b = other.values;
    const a0 = a[0], a1 = a[1], a2 = a[2];
    const a3 = a[3], a4 = a[4], a5 = a[5];
    const a6 = a[6], a7 = a[7], a8 = a[8];

    a[0] = a0 * b[0] + a1 * b[3] + a2 * b[6];
    a[1] = a0 * b[1] + a1 * b[4] + a2 * b[7];
    a[2] = a0 * b[2] + a1 * b[5] + a2 * b[8];
    a[3] = a3 * b[0] + a4 * b[3] + a5 * b[6];
    a[4] = a3 * b[1] + a4 * b[4] + a5 * b[7];
    a[5] = a3 * b[2] + a4 * b[5] + a5 * b[8];
    a[6] = a6 * b[0] + a7 * b[3] + a8 * b[6];
    a[7] = a6 * b[1] + a7 * b[4] + a8 * b[7];
    a[8] = a6 * b[2] + a7 * b[5] + a8 * b[8];
    return this;
  }

  transformPoint(point: Vec2): Vec2 {
    const v = this.values;
    return new Vec2(
      point.x * v[0] + point.y * v[1] + v[2],
      point.x * v[3] + point.y * v[4] + v[5],
    );
  }

  getInverse(): Matrix2d | null {
    const v = this.values;
    const det = v[0] * (v[4] * v[8] - v[5] * v[7])
              - v[1] * (v[3] * v[8] - v[5] * v[6])
              + v[2] * (v[3] * v[7] - v[4] * v[6]);
    if (det === 0) return null;
    const invDet = 1 / det;
    const inv = new Matrix2d();
    const r = inv.values;
    r[0] = (v[4] * v[8] - v[5] * v[7]) * invDet;
    r[1] = (v[2] * v[7] - v[1] * v[8]) * invDet;
    r[2] = (v[1] * v[5] - v[2] * v[4]) * invDet;
    r[3] = (v[5] * v[6] - v[3] * v[8]) * invDet;
    r[4] = (v[0] * v[8] - v[2] * v[6]) * invDet;
    r[5] = (v[2] * v[3] - v[0] * v[5]) * invDet;
    r[6] = (v[3] * v[7] - v[4] * v[6]) * invDet;
    r[7] = (v[1] * v[6] - v[0] * v[7]) * invDet;
    r[8] = (v[0] * v[4] - v[1] * v[3]) * invDet;
    return inv;
  }

  copy(other: Matrix2d): this {
    for (let i = 0; i < 9; i++) {
      this.values[i] = other.values[i];
    }
    return this;
  }

  compare(other: Matrix2d): boolean {
    for (let i = 0; i < 9; i++) {
      if (this.values[i] !== other.values[i]) return false;
    }
    return true;
  }

  clone(): Matrix2d {
    const m = new Matrix2d();
    m.copy(this);
    return m;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/modu-engine && npx vitest run tests/unit/math/Matrix2d.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/modu-engine
git add engine/core/math/Matrix2d.ts tests/unit/math/Matrix2d.test.ts
git commit -m "feat: add Matrix2d affine transformation class"
```

---

## Task 5: Rect (Phase 1)

**Files:**
- Create: `engine/core/math/Rect.ts`
- Test: `tests/unit/math/Rect.test.ts`

**Reference:** `/app/data/home/moddio2/engine/core/TaroRect.js`

- [ ] **Step 1: Write failing Rect tests**

```ts
// tests/unit/math/Rect.test.ts
import { describe, it, expect } from 'vitest';
import { Rect } from '../../../engine/core/math/Rect';
import { Vec2 } from '../../../engine/core/math/Vec2';

describe('Rect', () => {
  describe('construction', () => {
    it('defaults to zero', () => {
      const r = new Rect();
      expect(r.x).toBe(0);
      expect(r.y).toBe(0);
      expect(r.width).toBe(0);
      expect(r.height).toBe(0);
    });

    it('accepts x, y, width, height', () => {
      const r = new Rect(1, 2, 3, 4);
      expect(r.x).toBe(1);
      expect(r.y).toBe(2);
      expect(r.width).toBe(3);
      expect(r.height).toBe(4);
    });
  });

  describe('containsPoint', () => {
    it('returns true for point inside', () => {
      const r = new Rect(0, 0, 10, 10);
      expect(r.containsPoint(new Vec2(5, 5))).toBe(true);
    });

    it('returns false for point outside', () => {
      const r = new Rect(0, 0, 10, 10);
      expect(r.containsPoint(new Vec2(15, 5))).toBe(false);
    });

    it('returns true for point on edge', () => {
      const r = new Rect(0, 0, 10, 10);
      expect(r.containsPoint(new Vec2(0, 0))).toBe(true);
      expect(r.containsPoint(new Vec2(10, 10))).toBe(true);
    });
  });

  describe('containsXY', () => {
    it('checks raw x,y coordinates', () => {
      const r = new Rect(5, 5, 10, 10);
      expect(r.containsXY(10, 10)).toBe(true);
      expect(r.containsXY(0, 0)).toBe(false);
    });
  });

  describe('intersects', () => {
    it('returns true for overlapping rects', () => {
      const a = new Rect(0, 0, 10, 10);
      const b = new Rect(5, 5, 10, 10);
      expect(a.intersects(b)).toBe(true);
    });

    it('returns false for non-overlapping rects', () => {
      const a = new Rect(0, 0, 10, 10);
      const b = new Rect(20, 20, 10, 10);
      expect(a.intersects(b)).toBe(false);
    });

    it('returns true for touching rects', () => {
      const a = new Rect(0, 0, 10, 10);
      const b = new Rect(10, 0, 10, 10);
      expect(a.intersects(b)).toBe(true);
    });
  });

  describe('combine', () => {
    it('returns bounding rect of two rects', () => {
      const a = new Rect(0, 0, 10, 10);
      const b = new Rect(5, 5, 20, 20);
      const c = a.combine(b);
      expect(c.x).toBe(0);
      expect(c.y).toBe(0);
      expect(c.width).toBe(25);
      expect(c.height).toBe(25);
    });
  });

  describe('clone', () => {
    it('returns independent copy', () => {
      const a = new Rect(1, 2, 3, 4);
      const b = a.clone();
      expect(b.x).toBe(1);
      expect(b.width).toBe(3);
      expect(b).not.toBe(a);
    });
  });

  describe('equals', () => {
    it('compares all fields', () => {
      expect(new Rect(1, 2, 3, 4).equals(new Rect(1, 2, 3, 4))).toBe(true);
      expect(new Rect(1, 2, 3, 4).equals(new Rect(1, 2, 3, 5))).toBe(false);
    });
  });

  describe('toString', () => {
    it('formats rect', () => {
      expect(new Rect(1, 2, 3, 4).toString()).toBe('Rect(1, 2, 3, 4)');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/modu-engine && npx vitest run tests/unit/math/Rect.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Rect**

```ts
// engine/core/math/Rect.ts
import { Vec2 } from './Vec2';

export class Rect {
  constructor(
    public x: number = 0,
    public y: number = 0,
    public width: number = 0,
    public height: number = 0,
  ) {}

  containsPoint(point: Vec2): boolean {
    return point.x >= this.x && point.x <= this.x + this.width
        && point.y >= this.y && point.y <= this.y + this.height;
  }

  containsXY(x: number, y: number): boolean {
    return x >= this.x && x <= this.x + this.width
        && y >= this.y && y <= this.y + this.height;
  }

  intersects(other: Rect): boolean {
    return this.x <= other.x + other.width
        && this.x + this.width >= other.x
        && this.y <= other.y + other.height
        && this.y + this.height >= other.y;
  }

  combine(other: Rect): Rect {
    const x = Math.min(this.x, other.x);
    const y = Math.min(this.y, other.y);
    const right = Math.max(this.x + this.width, other.x + other.width);
    const bottom = Math.max(this.y + this.height, other.y + other.height);
    return new Rect(x, y, right - x, bottom - y);
  }

  clone(): Rect {
    return new Rect(this.x, this.y, this.width, this.height);
  }

  equals(other: Rect): boolean {
    return this.x === other.x && this.y === other.y
        && this.width === other.width && this.height === other.height;
  }

  toString(): string {
    return `Rect(${this.x}, ${this.y}, ${this.width}, ${this.height})`;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/modu-engine && npx vitest run tests/unit/math/Rect.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/modu-engine
git add engine/core/math/Rect.ts tests/unit/math/Rect.test.ts
git commit -m "feat: add Rect class with intersection and containment"
```

---

## Task 6: Polygon (Phase 1)

**Files:**
- Create: `engine/core/math/Polygon.ts`
- Test: `tests/unit/math/Polygon.test.ts`

**Reference:** `/app/data/home/moddio2/engine/core/TaroPoly2d.js`

Keep: point-in-polygon (ray casting), AABB, clone. Drop: canvas rendering, triangulation (can add later if needed).

- [ ] **Step 1: Write failing Polygon tests**

```ts
// tests/unit/math/Polygon.test.ts
import { describe, it, expect } from 'vitest';
import { Polygon } from '../../../engine/core/math/Polygon';
import { Vec2 } from '../../../engine/core/math/Vec2';
import { Rect } from '../../../engine/core/math/Rect';

describe('Polygon', () => {
  function makeSquare(): Polygon {
    return new Polygon([
      new Vec2(0, 0),
      new Vec2(10, 0),
      new Vec2(10, 10),
      new Vec2(0, 10),
    ]);
  }

  describe('construction', () => {
    it('stores vertices', () => {
      const p = makeSquare();
      expect(p.vertices.length).toBe(4);
    });

    it('creates empty polygon', () => {
      const p = new Polygon();
      expect(p.vertices.length).toBe(0);
    });
  });

  describe('addVertex', () => {
    it('appends vertex', () => {
      const p = new Polygon();
      p.addVertex(new Vec2(1, 2));
      p.addVertex(new Vec2(3, 4));
      expect(p.vertices.length).toBe(2);
      expect(p.vertices[0].x).toBe(1);
    });
  });

  describe('containsPoint', () => {
    it('returns true for point inside', () => {
      const p = makeSquare();
      expect(p.containsPoint(new Vec2(5, 5))).toBe(true);
    });

    it('returns false for point outside', () => {
      const p = makeSquare();
      expect(p.containsPoint(new Vec2(15, 5))).toBe(false);
    });

    it('works with concave polygon', () => {
      // L-shaped polygon
      const p = new Polygon([
        new Vec2(0, 0),
        new Vec2(10, 0),
        new Vec2(10, 5),
        new Vec2(5, 5),
        new Vec2(5, 10),
        new Vec2(0, 10),
      ]);
      expect(p.containsPoint(new Vec2(2, 2))).toBe(true);   // inside
      expect(p.containsPoint(new Vec2(7, 7))).toBe(false);  // in the notch
      expect(p.containsPoint(new Vec2(7, 2))).toBe(true);   // inside top part
    });
  });

  describe('aabb', () => {
    it('returns bounding rect', () => {
      const p = new Polygon([
        new Vec2(2, 3),
        new Vec2(8, 1),
        new Vec2(5, 9),
      ]);
      const bb = p.aabb();
      expect(bb.x).toBe(2);
      expect(bb.y).toBe(1);
      expect(bb.width).toBe(6);
      expect(bb.height).toBe(8);
    });

    it('returns zero rect for empty polygon', () => {
      const bb = new Polygon().aabb();
      expect(bb.width).toBe(0);
      expect(bb.height).toBe(0);
    });
  });

  describe('clone', () => {
    it('returns independent copy', () => {
      const a = makeSquare();
      const b = a.clone();
      expect(b.vertices.length).toBe(4);
      expect(b.vertices[0].x).toBe(0);
      expect(b).not.toBe(a);
      expect(b.vertices[0]).not.toBe(a.vertices[0]); // deep clone
    });
  });

  describe('vertexCount', () => {
    it('returns number of vertices', () => {
      expect(makeSquare().vertexCount()).toBe(4);
      expect(new Polygon().vertexCount()).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/modu-engine && npx vitest run tests/unit/math/Polygon.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Polygon**

```ts
// engine/core/math/Polygon.ts
import { Vec2 } from './Vec2';
import { Rect } from './Rect';

export class Polygon {
  vertices: Vec2[];

  constructor(vertices: Vec2[] = []) {
    this.vertices = vertices;
  }

  addVertex(point: Vec2): this {
    this.vertices.push(point);
    return this;
  }

  vertexCount(): number {
    return this.vertices.length;
  }

  containsPoint(point: Vec2): boolean {
    // Ray casting algorithm
    const verts = this.vertices;
    const n = verts.length;
    let inside = false;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const vi = verts[i];
      const vj = verts[j];

      if (
        (vi.y > point.y) !== (vj.y > point.y) &&
        point.x < ((vj.x - vi.x) * (point.y - vi.y)) / (vj.y - vi.y) + vi.x
      ) {
        inside = !inside;
      }
    }

    return inside;
  }

  aabb(): Rect {
    if (this.vertices.length === 0) {
      return new Rect(0, 0, 0, 0);
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const v of this.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }

    return new Rect(minX, minY, maxX - minX, maxY - minY);
  }

  clone(): Polygon {
    return new Polygon(this.vertices.map(v => v.clone()));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/modu-engine && npx vitest run tests/unit/math/Polygon.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/modu-engine
git add engine/core/math/Polygon.ts tests/unit/math/Polygon.test.ts
git commit -m "feat: add Polygon with ray-cast containment and AABB"
```

---

## Task 7: Math barrel export (Phase 1)

**Files:**
- Create: `engine/core/math/index.ts`

- [ ] **Step 1: Create barrel export**

```ts
// engine/core/math/index.ts
export { Vec2 } from './Vec2';
export { Vec3 } from './Vec3';
export { Matrix2d } from './Matrix2d';
export { Rect } from './Rect';
export { Polygon } from './Polygon';
```

- [ ] **Step 2: Run all math tests**

Run: `cd ~/modu-engine && npx vitest run tests/unit/math/`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
cd ~/modu-engine
git add engine/core/math/index.ts
git commit -m "feat: add math barrel export"
```

---

## Task 8: EventEmitter (Phase 2)

**Files:**
- Create: `engine/core/events/EventEmitter.ts`
- Create: `engine/core/events/index.ts`
- Test: `tests/unit/events/EventEmitter.test.ts`

**Reference:** `/app/data/home/moddio2/engine/core/TaroEventingClass.js`

The old system has: on, off, emit, oneShot listeners, deferred removal during emit. We keep all of that but with proper types and a simpler API (no `sendEventName` mode, no array-based multi-event conditions — those are rarely used).

- [ ] **Step 1: Write failing EventEmitter tests**

```ts
// tests/unit/events/EventEmitter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../../engine/core/events/EventEmitter';

describe('EventEmitter', () => {
  describe('on and emit', () => {
    it('calls listener when event is emitted', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      emitter.on('test', fn);
      emitter.emit('test');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('passes data to listener', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      emitter.on('test', fn);
      emitter.emit('test', { foo: 'bar' });
      expect(fn).toHaveBeenCalledWith({ foo: 'bar' });
    });

    it('supports multiple listeners', () => {
      const emitter = new EventEmitter();
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      emitter.on('test', fn1);
      emitter.on('test', fn2);
      emitter.emit('test');
      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).toHaveBeenCalledOnce();
    });

    it('does not call listener for different event', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      emitter.on('test', fn);
      emitter.emit('other');
      expect(fn).not.toHaveBeenCalled();
    });

    it('passes multiple arguments via array', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      emitter.on('test', fn);
      emitter.emit('test', [1, 2, 3]);
      expect(fn).toHaveBeenCalledWith(1, 2, 3);
    });
  });

  describe('off', () => {
    it('removes a specific listener', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      const handle = emitter.on('test', fn);
      emitter.off('test', handle);
      emitter.emit('test');
      expect(fn).not.toHaveBeenCalled();
    });

    it('does not affect other listeners', () => {
      const emitter = new EventEmitter();
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      const handle1 = emitter.on('test', fn1);
      emitter.on('test', fn2);
      emitter.off('test', handle1);
      emitter.emit('test');
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalledOnce();
    });
  });

  describe('once', () => {
    it('fires listener only once', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      emitter.once('test', fn);
      emitter.emit('test');
      emitter.emit('test');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('passes data to one-shot listener', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      emitter.once('test', fn);
      emitter.emit('test', 42);
      expect(fn).toHaveBeenCalledWith(42);
    });
  });

  describe('emit during emit (deferred removal)', () => {
    it('safely removes listener during emit', () => {
      const emitter = new EventEmitter();
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      let handle1: unknown;
      handle1 = emitter.on('test', () => {
        fn1();
        emitter.off('test', handle1 as ReturnType<typeof emitter.on>);
      });
      emitter.on('test', fn2);
      emitter.emit('test');
      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).toHaveBeenCalledOnce();
      // Second emit: fn1 should be gone
      fn1.mockClear();
      fn2.mockClear();
      emitter.emit('test');
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalledOnce();
    });
  });

  describe('removeAllListeners', () => {
    it('removes all listeners for an event', () => {
      const emitter = new EventEmitter();
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      emitter.on('test', fn1);
      emitter.on('test', fn2);
      emitter.removeAllListeners('test');
      emitter.emit('test');
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).not.toHaveBeenCalled();
    });

    it('removes all listeners when no event specified', () => {
      const emitter = new EventEmitter();
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      emitter.on('a', fn1);
      emitter.on('b', fn2);
      emitter.removeAllListeners();
      emitter.emit('a');
      emitter.emit('b');
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).not.toHaveBeenCalled();
    });
  });

  describe('listenerCount', () => {
    it('returns count for event', () => {
      const emitter = new EventEmitter();
      emitter.on('test', () => {});
      emitter.on('test', () => {});
      emitter.on('other', () => {});
      expect(emitter.listenerCount('test')).toBe(2);
      expect(emitter.listenerCount('other')).toBe(1);
      expect(emitter.listenerCount('none')).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/modu-engine && npx vitest run tests/unit/events/EventEmitter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement EventEmitter**

```ts
// engine/core/events/EventEmitter.ts
export type EventListener = (...args: unknown[]) => void;

export interface EventHandle {
  callback: EventListener;
  once: boolean;
}

export class EventEmitter {
  private _listeners = new Map<string, EventHandle[]>();
  private _emitting = false;
  private _removeQueue: Array<{ event: string; handle: EventHandle }> = [];

  on(event: string, callback: EventListener): EventHandle {
    const handle: EventHandle = { callback, once: false };
    this._getOrCreate(event).push(handle);
    return handle;
  }

  once(event: string, callback: EventListener): EventHandle {
    const handle: EventHandle = { callback, once: true };
    this._getOrCreate(event).push(handle);
    return handle;
  }

  off(event: string, handle: EventHandle): boolean {
    if (this._emitting) {
      this._removeQueue.push({ event, handle });
      return true;
    }
    return this._removeHandle(event, handle);
  }

  emit(event: string, data?: unknown): void {
    const handles = this._listeners.get(event);
    if (!handles || handles.length === 0) return;

    this._emitting = true;

    // Iterate over a snapshot of the current length to avoid issues
    // with listeners added during emit
    const len = handles.length;
    for (let i = 0; i < len; i++) {
      const handle = handles[i];
      if (Array.isArray(data)) {
        handle.callback(...data);
      } else if (data !== undefined) {
        handle.callback(data);
      } else {
        handle.callback();
      }

      if (handle.once) {
        this._removeQueue.push({ event, handle });
      }
    }

    this._emitting = false;
    this._processRemoveQueue();
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }

  listenerCount(event: string): number {
    return this._listeners.get(event)?.length ?? 0;
  }

  private _getOrCreate(event: string): EventHandle[] {
    let arr = this._listeners.get(event);
    if (!arr) {
      arr = [];
      this._listeners.set(event, arr);
    }
    return arr;
  }

  private _removeHandle(event: string, handle: EventHandle): boolean {
    const arr = this._listeners.get(event);
    if (!arr) return false;
    const idx = arr.indexOf(handle);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    return true;
  }

  private _processRemoveQueue(): void {
    for (const { event, handle } of this._removeQueue) {
      this._removeHandle(event, handle);
    }
    this._removeQueue.length = 0;
  }
}
```

- [ ] **Step 4: Create barrel export**

```ts
// engine/core/events/index.ts
export { EventEmitter } from './EventEmitter';
export type { EventListener, EventHandle } from './EventEmitter';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/modu-engine && npx vitest run tests/unit/events/EventEmitter.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/modu-engine
git add engine/core/events/ tests/unit/events/
git commit -m "feat: add EventEmitter with deferred removal during emit"
```

---

## Task 9: Component base class (Phase 3)

**Files:**
- Create: `engine/core/ecs/Component.ts`
- Test: `tests/unit/ecs/Component.test.ts`

**Reference:** Component pattern from `/app/data/home/moddio2/engine/core/TaroClass.js` (addComponent) and `/app/data/home/moddio2/engine/components/TaroTimeComponent.js`

In the old engine, components are classes with a `componentId` that get attached to entities. We simplify: Component is a base class with lifecycle hooks. Entity manages the collection.

- [ ] **Step 1: Write failing Component tests**

```ts
// tests/unit/ecs/Component.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Component } from '../../../engine/core/ecs/Component';

class TestComponent extends Component {
  static readonly id = 'test';
  value = 0;

  update(dt: number): void {
    this.value += dt;
  }
}

class AnotherComponent extends Component {
  static readonly id = 'another';
  name = 'default';
}

describe('Component', () => {
  it('has a static id', () => {
    expect(TestComponent.id).toBe('test');
  });

  it('starts without an entity reference', () => {
    const c = new TestComponent();
    expect(c.entity).toBeNull();
  });

  it('update is callable', () => {
    const c = new TestComponent();
    c.update(16);
    expect(c.value).toBe(16);
  });

  it('destroy is callable', () => {
    const c = new TestComponent();
    expect(() => c.destroy()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/modu-engine && npx vitest run tests/unit/ecs/Component.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Component**

```ts
// engine/core/ecs/Component.ts
import type { Entity } from './Entity';

export abstract class Component {
  static readonly id: string;
  entity: Entity | null = null;

  update(_dt: number): void {}
  destroy(): void {}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/modu-engine && npx vitest run tests/unit/ecs/Component.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/modu-engine
git add engine/core/ecs/Component.ts tests/unit/ecs/Component.test.ts
git commit -m "feat: add Component base class with lifecycle hooks"
```

---

## Task 10: Entity (Phase 3)

**Files:**
- Create: `engine/core/ecs/Entity.ts`
- Test: `tests/unit/ecs/Entity.test.ts`

**Reference:** `/app/data/home/moddio2/engine/core/TaroObject.js` (ID, parent/child, mount, lifecycle) and `/app/data/home/moddio2/engine/core/TaroEntity.js` (transform)

The old TaroEntity is 5,740 lines. We extract the essentials: ID, parent/child hierarchy, component management, transform (position/rotation/scale), lifecycle (alive/destroy), and categories. Everything else (streaming, networking, bounds, animation) goes into their respective modules.

- [ ] **Step 1: Write failing Entity tests**

```ts
// tests/unit/ecs/Entity.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Entity } from '../../../engine/core/ecs/Entity';
import { Component } from '../../../engine/core/ecs/Component';
import { Vec3 } from '../../../engine/core/math/Vec3';

class HealthComponent extends Component {
  static readonly id = 'health';
  current = 100;
  max = 100;

  update(dt: number): void {
    // regen 1hp per second
    this.current = Math.min(this.current + dt / 1000, this.max);
  }
}

class SpeedComponent extends Component {
  static readonly id = 'speed';
  value = 5;
}

describe('Entity', () => {
  describe('identification', () => {
    it('generates unique id', () => {
      const a = new Entity();
      const b = new Entity();
      expect(a.id).toBeTruthy();
      expect(b.id).toBeTruthy();
      expect(a.id).not.toBe(b.id);
    });

    it('accepts custom id', () => {
      const e = new Entity('custom-id');
      expect(e.id).toBe('custom-id');
    });
  });

  describe('lifecycle', () => {
    it('starts alive', () => {
      expect(new Entity().alive).toBe(true);
    });

    it('destroy sets alive to false', () => {
      const e = new Entity();
      e.destroy();
      expect(e.alive).toBe(false);
    });

    it('destroy removes from parent', () => {
      const parent = new Entity();
      const child = new Entity();
      child.mount(parent);
      child.destroy();
      expect(parent.children.length).toBe(0);
    });

    it('destroy recursively destroys children', () => {
      const parent = new Entity();
      const child = new Entity();
      const grandchild = new Entity();
      child.mount(parent);
      grandchild.mount(child);
      parent.destroy();
      expect(child.alive).toBe(false);
      expect(grandchild.alive).toBe(false);
    });

    it('destroy calls destroy on components', () => {
      const e = new Entity();
      const comp = new HealthComponent();
      const destroySpy = vi.spyOn(comp, 'destroy');
      e.addComponent(comp);
      e.destroy();
      expect(destroySpy).toHaveBeenCalledOnce();
    });
  });

  describe('parent/child', () => {
    it('mount sets parent and adds to children', () => {
      const parent = new Entity();
      const child = new Entity();
      child.mount(parent);
      expect(child.parent).toBe(parent);
      expect(parent.children).toContain(child);
    });

    it('unmount removes from parent', () => {
      const parent = new Entity();
      const child = new Entity();
      child.mount(parent);
      child.unmount();
      expect(child.parent).toBeNull();
      expect(parent.children.length).toBe(0);
    });

    it('mounting to new parent unmounts from old', () => {
      const parent1 = new Entity();
      const parent2 = new Entity();
      const child = new Entity();
      child.mount(parent1);
      child.mount(parent2);
      expect(parent1.children.length).toBe(0);
      expect(parent2.children).toContain(child);
      expect(child.parent).toBe(parent2);
    });

    it('cannot mount to self', () => {
      const e = new Entity();
      expect(() => e.mount(e)).toThrow();
    });
  });

  describe('components', () => {
    it('addComponent attaches component', () => {
      const e = new Entity();
      const health = new HealthComponent();
      e.addComponent(health);
      expect(e.getComponent(HealthComponent)).toBe(health);
      expect(health.entity).toBe(e);
    });

    it('getComponent returns null if not found', () => {
      const e = new Entity();
      expect(e.getComponent(HealthComponent)).toBeNull();
    });

    it('hasComponent checks existence', () => {
      const e = new Entity();
      expect(e.hasComponent(HealthComponent)).toBe(false);
      e.addComponent(new HealthComponent());
      expect(e.hasComponent(HealthComponent)).toBe(true);
    });

    it('removeComponent detaches component', () => {
      const e = new Entity();
      const health = new HealthComponent();
      e.addComponent(health);
      e.removeComponent(HealthComponent);
      expect(e.getComponent(HealthComponent)).toBeNull();
      expect(health.entity).toBeNull();
    });

    it('removeComponent calls destroy on component', () => {
      const e = new Entity();
      const health = new HealthComponent();
      const spy = vi.spyOn(health, 'destroy');
      e.addComponent(health);
      e.removeComponent(HealthComponent);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('supports multiple component types', () => {
      const e = new Entity();
      e.addComponent(new HealthComponent());
      e.addComponent(new SpeedComponent());
      expect(e.getComponent(HealthComponent)?.current).toBe(100);
      expect(e.getComponent(SpeedComponent)?.value).toBe(5);
    });
  });

  describe('transform', () => {
    it('position defaults to origin', () => {
      const e = new Entity();
      expect(e.position.equals(Vec3.zero())).toBe(true);
    });

    it('position can be set', () => {
      const e = new Entity();
      e.position.set(10, 20, 30);
      expect(e.position.x).toBe(10);
      expect(e.position.y).toBe(20);
      expect(e.position.z).toBe(30);
    });

    it('rotation defaults to zero', () => {
      const e = new Entity();
      expect(e.rotation).toBe(0);
    });

    it('scale defaults to (1,1,1)', () => {
      const e = new Entity();
      expect(e.scale.equals(Vec3.one())).toBe(true);
    });
  });

  describe('category', () => {
    it('can set and get category', () => {
      const e = new Entity();
      e.category = 'unit';
      expect(e.category).toBe('unit');
    });

    it('defaults to empty string', () => {
      const e = new Entity();
      expect(e.category).toBe('');
    });
  });

  describe('update', () => {
    it('updates all components', () => {
      const e = new Entity();
      const health = new HealthComponent();
      health.current = 50;
      e.addComponent(health);
      e.update(1000); // 1 second
      expect(health.current).toBe(51);
    });

    it('does not update if not alive', () => {
      const e = new Entity();
      const health = new HealthComponent();
      health.current = 50;
      e.addComponent(health);
      e.destroy();
      e.update(1000);
      expect(health.current).toBe(50); // unchanged
    });
  });

  describe('layer and depth', () => {
    it('layer defaults to 0', () => {
      expect(new Entity().layer).toBe(0);
    });

    it('depth defaults to 0', () => {
      expect(new Entity().depth).toBe(0);
    });

    it('layer and depth can be set', () => {
      const e = new Entity();
      e.layer = 5;
      e.depth = 10;
      expect(e.layer).toBe(5);
      expect(e.depth).toBe(10);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/modu-engine && npx vitest run tests/unit/ecs/Entity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Entity**

```ts
// engine/core/ecs/Entity.ts
import { Vec3 } from '../math/Vec3';
import { Component } from './Component';

let _nextId = 0;
function generateId(): string {
  return `entity_${++_nextId}_${Math.random().toString(36).slice(2, 10)}`;
}

type ComponentClass<T extends Component> = {
  readonly id: string;
  new (...args: unknown[]): T;
};

export class Entity {
  readonly id: string;
  alive = true;
  parent: Entity | null = null;
  children: Entity[] = [];
  position = new Vec3(0, 0, 0);
  rotation = 0;
  scale = new Vec3(1, 1, 1);
  layer = 0;
  depth = 0;
  category = '';

  private _components = new Map<string, Component>();

  constructor(id?: string) {
    this.id = id ?? generateId();
  }

  // --- Parent/Child ---

  mount(parent: Entity): this {
    if (parent === this) {
      throw new Error('Cannot mount entity to itself');
    }
    if (this.parent) {
      this.unmount();
    }
    this.parent = parent;
    parent.children.push(this);
    return this;
  }

  unmount(): this {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx !== -1) {
        this.parent.children.splice(idx, 1);
      }
      this.parent = null;
    }
    return this;
  }

  // --- Components ---

  addComponent<T extends Component>(component: T): T {
    const ctor = component.constructor as ComponentClass<T>;
    this._components.set(ctor.id, component);
    component.entity = this;
    return component;
  }

  getComponent<T extends Component>(ctor: ComponentClass<T>): T | null {
    return (this._components.get(ctor.id) as T) ?? null;
  }

  hasComponent<T extends Component>(ctor: ComponentClass<T>): boolean {
    return this._components.has(ctor.id);
  }

  removeComponent<T extends Component>(ctor: ComponentClass<T>): void {
    const comp = this._components.get(ctor.id);
    if (comp) {
      comp.destroy();
      comp.entity = null;
      this._components.delete(ctor.id);
    }
  }

  // --- Lifecycle ---

  update(dt: number): void {
    if (!this.alive) return;
    for (const comp of this._components.values()) {
      comp.update(dt);
    }
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;

    // Destroy children first (copy array since destroy modifies it)
    const kids = [...this.children];
    for (const child of kids) {
      child.destroy();
    }

    // Destroy components
    for (const comp of this._components.values()) {
      comp.destroy();
      comp.entity = null;
    }
    this._components.clear();

    // Unmount from parent
    this.unmount();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/modu-engine && npx vitest run tests/unit/ecs/Entity.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/modu-engine
git add engine/core/ecs/Entity.ts tests/unit/ecs/Entity.test.ts
git commit -m "feat: add Entity with parent/child, components, transform"
```

---

## Task 11: System base class (Phase 3)

**Files:**
- Create: `engine/core/ecs/System.ts`
- Test: `tests/unit/ecs/System.test.ts`

Systems process entities with specific component sets each tick. This replaces the old "behaviour" pattern.

- [ ] **Step 1: Write failing System tests**

```ts
// tests/unit/ecs/System.test.ts
import { describe, it, expect, vi } from 'vitest';
import { System } from '../../../engine/core/ecs/System';
import { Entity } from '../../../engine/core/ecs/Entity';

describe('System', () => {
  it('can be extended with custom update logic', () => {
    const updateFn = vi.fn();

    class TestSystem extends System {
      update(dt: number, entities: Entity[]): void {
        updateFn(dt, entities.length);
      }
    }

    const sys = new TestSystem();
    const entities = [new Entity(), new Entity()];
    sys.update(16, entities);
    expect(updateFn).toHaveBeenCalledWith(16, 2);
  });

  it('has a name', () => {
    class PhysicsSystem extends System {
      readonly name = 'physics';
      update(): void {}
    }
    expect(new PhysicsSystem().name).toBe('physics');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/modu-engine && npx vitest run tests/unit/ecs/System.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement System**

```ts
// engine/core/ecs/System.ts
import type { Entity } from './Entity';

export abstract class System {
  readonly name: string = '';
  abstract update(dt: number, entities: Entity[]): void;
}
```

- [ ] **Step 4: Create ECS barrel export**

```ts
// engine/core/ecs/index.ts
export { Component } from './Component';
export { Entity } from './Entity';
export { System } from './System';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/modu-engine && npx vitest run tests/unit/ecs/`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/modu-engine
git add engine/core/ecs/ tests/unit/ecs/
git commit -m "feat: add System base class and ECS barrel export"
```

---

## Task 12: Clock (Phase 4)

**Files:**
- Create: `engine/core/time/Clock.ts`
- Create: `engine/core/time/index.ts`
- Test: `tests/unit/time/Clock.test.ts`

**Reference:** TaroEngine.js game loop timing + TaroTimeComponent.js timer system.

The Clock manages: current time, delta time, tick rate, and named timers/intervals.

- [ ] **Step 1: Write failing Clock tests**

```ts
// tests/unit/time/Clock.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Clock } from '../../../engine/core/time/Clock';

describe('Clock', () => {
  let clock: Clock;

  beforeEach(() => {
    clock = new Clock(60); // 60 ticks per second
  });

  describe('construction', () => {
    it('initializes with tick rate', () => {
      expect(clock.tickRate).toBe(60);
    });

    it('starts at time 0', () => {
      expect(clock.elapsed).toBe(0);
    });

    it('starts with 0 delta', () => {
      expect(clock.dt).toBe(0);
    });

    it('starts at tick 0', () => {
      expect(clock.tick).toBe(0);
    });
  });

  describe('step', () => {
    it('advances elapsed time', () => {
      clock.step(16.67);
      expect(clock.elapsed).toBeCloseTo(16.67);
    });

    it('sets delta time', () => {
      clock.step(16.67);
      expect(clock.dt).toBeCloseTo(16.67);
    });

    it('increments tick counter', () => {
      clock.step(16.67);
      expect(clock.tick).toBe(1);
    });

    it('accumulates elapsed over multiple steps', () => {
      clock.step(10);
      clock.step(20);
      expect(clock.elapsed).toBeCloseTo(30);
      expect(clock.dt).toBeCloseTo(20); // latest delta only
      expect(clock.tick).toBe(2);
    });
  });

  describe('timers', () => {
    it('addTimer fires callback after delay', () => {
      const fn = vi.fn();
      clock.addTimer('test', 100, fn);
      clock.step(50);
      expect(fn).not.toHaveBeenCalled();
      clock.step(60); // total 110ms
      expect(fn).toHaveBeenCalledOnce();
    });

    it('timer auto-removes after firing (one-shot)', () => {
      const fn = vi.fn();
      clock.addTimer('test', 100, fn);
      clock.step(110);
      expect(fn).toHaveBeenCalledOnce();
      fn.mockClear();
      clock.step(110); // another 110ms
      expect(fn).not.toHaveBeenCalled();
    });

    it('removeTimer prevents callback', () => {
      const fn = vi.fn();
      clock.addTimer('test', 100, fn);
      clock.removeTimer('test');
      clock.step(200);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('intervals', () => {
    it('addInterval fires repeatedly', () => {
      const fn = vi.fn();
      clock.addInterval('test', 100, fn);
      clock.step(100);
      expect(fn).toHaveBeenCalledTimes(1);
      clock.step(100);
      expect(fn).toHaveBeenCalledTimes(2);
      clock.step(100);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('removeInterval stops repeating', () => {
      const fn = vi.fn();
      clock.addInterval('test', 100, fn);
      clock.step(100);
      expect(fn).toHaveBeenCalledTimes(1);
      clock.removeInterval('test');
      clock.step(100);
      expect(fn).toHaveBeenCalledTimes(1); // no more calls
    });
  });

  describe('targetDt', () => {
    it('computes target dt from tick rate', () => {
      expect(clock.targetDt).toBeCloseTo(1000 / 60);
    });

    it('updates when tick rate changes', () => {
      clock.tickRate = 30;
      expect(clock.targetDt).toBeCloseTo(1000 / 30);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/modu-engine && npx vitest run tests/unit/time/Clock.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Clock**

```ts
// engine/core/time/Clock.ts
interface TimerEntry {
  name: string;
  delay: number;
  elapsed: number;
  callback: () => void;
  repeat: boolean;
}

export class Clock {
  tickRate: number;
  elapsed = 0;
  dt = 0;
  tick = 0;

  private _timers = new Map<string, TimerEntry>();

  constructor(tickRate: number = 60) {
    this.tickRate = tickRate;
  }

  get targetDt(): number {
    return 1000 / this.tickRate;
  }

  step(dtMs: number): void {
    this.dt = dtMs;
    this.elapsed += dtMs;
    this.tick++;
    this._updateTimers(dtMs);
  }

  addTimer(name: string, delayMs: number, callback: () => void): void {
    this._timers.set(name, {
      name,
      delay: delayMs,
      elapsed: 0,
      callback,
      repeat: false,
    });
  }

  removeTimer(name: string): void {
    this._timers.delete(name);
  }

  addInterval(name: string, intervalMs: number, callback: () => void): void {
    this._timers.set(name, {
      name,
      delay: intervalMs,
      elapsed: 0,
      callback,
      repeat: true,
    });
  }

  removeInterval(name: string): void {
    this._timers.delete(name);
  }

  private _updateTimers(dtMs: number): void {
    const toRemove: string[] = [];

    for (const [name, timer] of this._timers) {
      timer.elapsed += dtMs;
      if (timer.elapsed >= timer.delay) {
        timer.callback();
        if (timer.repeat) {
          timer.elapsed -= timer.delay;
        } else {
          toRemove.push(name);
        }
      }
    }

    for (const name of toRemove) {
      this._timers.delete(name);
    }
  }
}
```

- [ ] **Step 4: Create barrel export**

```ts
// engine/core/time/index.ts
export { Clock } from './Clock';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/modu-engine && npx vitest run tests/unit/time/Clock.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/modu-engine
git add engine/core/time/ tests/unit/time/
git commit -m "feat: add Clock with timers, intervals, and tick tracking"
```

---

## Task 13: Engine core orchestrator (Phase 4)

**Files:**
- Create: `engine/core/Engine.ts`
- Modify: `engine/core/index.ts`
- Test: `tests/unit/core/Engine.test.ts`

**Reference:** `/app/data/home/moddio2/engine/core/TaroEngine.js` — game loop, update/render cycle, component management.

The Engine is the singleton orchestrator. It owns the Clock, EventEmitter, root entity (scene graph), and the system update loop. It does NOT own rendering or networking (those are client/server concerns).

- [ ] **Step 1: Write failing Engine tests**

```ts
// tests/unit/core/Engine.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Engine } from '../../../engine/core/Engine';
import { Entity } from '../../../engine/core/ecs/Entity';
import { Component } from '../../../engine/core/ecs/Component';
import { System } from '../../../engine/core/ecs/System';

class CounterComponent extends Component {
  static readonly id = 'counter';
  count = 0;
  update(dt: number): void {
    this.count++;
  }
}

class LogSystem extends System {
  readonly name = 'log';
  calls: number[] = [];
  update(dt: number, entities: Entity[]): void {
    this.calls.push(dt);
  }
}

describe('Engine', () => {
  let engine: Engine;

  beforeEach(() => {
    Engine.reset();
    engine = Engine.instance();
  });

  afterEach(() => {
    engine.stop();
  });

  describe('singleton', () => {
    it('returns same instance', () => {
      expect(Engine.instance()).toBe(engine);
    });

    it('reset creates new instance', () => {
      const old = engine;
      Engine.reset();
      expect(Engine.instance()).not.toBe(old);
    });
  });

  describe('properties', () => {
    it('has a clock', () => {
      expect(engine.clock).toBeDefined();
      expect(engine.clock.tickRate).toBe(60);
    });

    it('has an event emitter', () => {
      expect(engine.events).toBeDefined();
    });

    it('has a root entity', () => {
      expect(engine.root).toBeDefined();
      expect(engine.root).toBeInstanceOf(Entity);
    });
  });

  describe('entity management', () => {
    it('spawn creates entity mounted to root', () => {
      const e = engine.spawn();
      expect(e.parent).toBe(engine.root);
      expect(engine.root.children).toContain(e);
    });

    it('spawn with id', () => {
      const e = engine.spawn('player1');
      expect(e.id).toBe('player1');
    });

    it('findById returns entity', () => {
      const e = engine.spawn('findme');
      expect(engine.findById('findme')).toBe(e);
    });

    it('findById returns null for missing', () => {
      expect(engine.findById('nope')).toBeNull();
    });
  });

  describe('systems', () => {
    it('addSystem registers a system', () => {
      const sys = new LogSystem();
      engine.addSystem(sys);
      expect(engine.getSystem('log')).toBe(sys);
    });

    it('removeSystem unregisters a system', () => {
      const sys = new LogSystem();
      engine.addSystem(sys);
      engine.removeSystem('log');
      expect(engine.getSystem('log')).toBeNull();
    });
  });

  describe('step', () => {
    it('advances the clock', () => {
      engine.step(16.67);
      expect(engine.clock.tick).toBe(1);
      expect(engine.clock.dt).toBeCloseTo(16.67);
    });

    it('updates all entities in the scene graph', () => {
      const e = engine.spawn();
      const counter = new CounterComponent();
      e.addComponent(counter);
      engine.step(16);
      expect(counter.count).toBe(1);
    });

    it('runs all systems', () => {
      const sys = new LogSystem();
      engine.addSystem(sys);
      engine.step(16);
      engine.step(32);
      expect(sys.calls).toEqual([16, 32]);
    });

    it('emits preUpdate and postUpdate events', () => {
      const preFn = vi.fn();
      const postFn = vi.fn();
      engine.events.on('preUpdate', preFn);
      engine.events.on('postUpdate', postFn);
      engine.step(16);
      expect(preFn).toHaveBeenCalledOnce();
      expect(postFn).toHaveBeenCalledOnce();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/modu-engine && npx vitest run tests/unit/core/Engine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Engine**

```ts
// engine/core/Engine.ts
import { Clock } from './time/Clock';
import { EventEmitter } from './events/EventEmitter';
import { Entity } from './ecs/Entity';
import { System } from './ecs/System';

export class Engine {
  private static _instance: Engine | null = null;

  readonly clock: Clock;
  readonly events: EventEmitter;
  readonly root: Entity;

  private _systems = new Map<string, System>();
  private _entityRegistry = new Map<string, Entity>();
  private _running = false;

  private constructor() {
    this.clock = new Clock(60);
    this.events = new EventEmitter();
    this.root = new Entity('root');
  }

  static instance(): Engine {
    if (!Engine._instance) {
      Engine._instance = new Engine();
    }
    return Engine._instance;
  }

  static reset(): void {
    if (Engine._instance) {
      Engine._instance.stop();
    }
    Engine._instance = null;
  }

  // --- Entity management ---

  spawn(id?: string): Entity {
    const entity = new Entity(id);
    entity.mount(this.root);
    this._entityRegistry.set(entity.id, entity);
    return entity;
  }

  findById(id: string): Entity | null {
    return this._entityRegistry.get(id) ?? null;
  }

  // --- Systems ---

  addSystem(system: System): void {
    this._systems.set(system.name, system);
  }

  getSystem(name: string): System | null {
    return this._systems.get(name) ?? null;
  }

  removeSystem(name: string): void {
    this._systems.delete(name);
  }

  // --- Game loop ---

  step(dtMs: number): void {
    this.clock.step(dtMs);
    this.events.emit('preUpdate', dtMs);

    // Update all entities in scene graph
    this._updateEntity(this.root, dtMs);

    // Run systems
    const entities = this.root.children;
    for (const system of this._systems.values()) {
      system.update(dtMs, entities);
    }

    this.events.emit('postUpdate', dtMs);
  }

  stop(): void {
    this._running = false;
  }

  private _updateEntity(entity: Entity, dt: number): void {
    entity.update(dt);
    for (const child of entity.children) {
      this._updateEntity(child, dt);
    }
  }
}
```

- [ ] **Step 4: Update core barrel export**

```ts
// engine/core/index.ts
export const VERSION = '0.1.0';

export { Engine } from './Engine';
export { Vec2, Vec3, Matrix2d, Rect, Polygon } from './math/index';
export { EventEmitter } from './events/index';
export { Entity, Component, System } from './ecs/index';
export { Clock } from './time/index';
```

- [ ] **Step 5: Run all tests**

Run: `cd ~/modu-engine && npx vitest run`
Expected: All tests PASS (setup + math + events + ecs + time + engine).

- [ ] **Step 6: Commit**

```bash
cd ~/modu-engine
git add engine/core/Engine.ts engine/core/index.ts tests/unit/core/
git commit -m "feat: add Engine singleton with game loop, systems, and entity management"
```

---

## Task 14: Final verification and push

- [ ] **Step 1: Run full test suite**

Run: `cd ~/modu-engine && npx vitest run`
Expected: All tests pass. Zero failures.

- [ ] **Step 2: Verify TypeScript compiles cleanly**

Run: `cd ~/modu-engine && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Push to remote**

```bash
cd ~/modu-engine && git push origin main
```
