export class Vec2 {
  constructor(public x: number = 0, public y: number = 0) {}

  add(other: Vec2): Vec2 { return new Vec2(this.x + other.x, this.y + other.y); }
  sub(other: Vec2): Vec2 { return new Vec2(this.x - other.x, this.y - other.y); }

  mul(arg: number | Vec2): Vec2 {
    if (typeof arg === 'number') return new Vec2(this.x * arg, this.y * arg);
    return new Vec2(this.x * arg.x, this.y * arg.y);
  }

  div(arg: number | Vec2): Vec2 {
    if (typeof arg === 'number') return new Vec2(this.x / arg, this.y / arg);
    return new Vec2(this.x / arg.x, this.y / arg.y);
  }

  rotate(radians: number): Vec2 {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return new Vec2(cos * this.x - sin * this.y, sin * this.x + cos * this.y);
  }

  normalize(): Vec2 {
    const len = this.length();
    if (len === 0) return new Vec2(0, 0);
    return new Vec2(this.x / len, this.y / len);
  }

  lerp(target: Vec2, t: number): Vec2 {
    return new Vec2(this.x + (target.x - this.x) * t, this.y + (target.y - this.y) * t);
  }

  clone(): Vec2 { return new Vec2(this.x, this.y); }
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y); }
  lengthSquared(): number { return this.x * this.x + this.y * this.y; }
  dot(other: Vec2): number { return this.x * other.x + this.y * other.y; }
  cross(other: Vec2): number { return this.x * other.y - this.y * other.x; }

  distanceTo(other: Vec2): number {
    const dx = this.x - other.x, dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  equals(other: Vec2): boolean { return this.x === other.x && this.y === other.y; }

  set(x: number, y: number): this { this.x = x; this.y = y; return this; }
  copy(other: Vec2): this { this.x = other.x; this.y = other.y; return this; }

  toString(precision: number = 2): string {
    return `(${this.x.toFixed(precision)}, ${this.y.toFixed(precision)})`;
  }

  static zero(): Vec2 { return new Vec2(0, 0); }
  static one(): Vec2 { return new Vec2(1, 1); }
}
