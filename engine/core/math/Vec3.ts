export class Vec3 {
  constructor(public x: number = 0, public y: number = 0, public z: number = 0) {}

  add(other: Vec3): Vec3 { return new Vec3(this.x + other.x, this.y + other.y, this.z + other.z); }
  sub(other: Vec3): Vec3 { return new Vec3(this.x - other.x, this.y - other.y, this.z - other.z); }
  mul(arg: number | Vec3): Vec3 {
    if (typeof arg === 'number') return new Vec3(this.x * arg, this.y * arg, this.z * arg);
    return new Vec3(this.x * arg.x, this.y * arg.y, this.z * arg.z);
  }
  div(arg: number | Vec3): Vec3 {
    if (typeof arg === 'number') return new Vec3(this.x / arg, this.y / arg, this.z / arg);
    return new Vec3(this.x / arg.x, this.y / arg.y, this.z / arg.z);
  }
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  lengthSquared(): number { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize(): Vec3 {
    const len = this.length();
    if (len === 0) return new Vec3(0, 0, 0);
    return new Vec3(this.x / len, this.y / len, this.z / len);
  }
  dot(other: Vec3): number { return this.x * other.x + this.y * other.y + this.z * other.z; }
  cross(other: Vec3): Vec3 {
    return new Vec3(
      this.y * other.z - this.z * other.y,
      this.z * other.x - this.x * other.z,
      this.x * other.y - this.y * other.x,
    );
  }
  distanceTo(other: Vec3): number {
    const dx = this.x - other.x, dy = this.y - other.y, dz = this.z - other.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  lerp(target: Vec3, t: number): Vec3 {
    return new Vec3(this.x + (target.x - this.x) * t, this.y + (target.y - this.y) * t, this.z + (target.z - this.z) * t);
  }
  rotateZ(radians: number): Vec3 {
    const cos = Math.cos(radians), sin = Math.sin(radians);
    return new Vec3(cos * this.x - sin * this.y, sin * this.x + cos * this.y, this.z);
  }
  clone(): Vec3 { return new Vec3(this.x, this.y, this.z); }
  equals(other: Vec3): boolean { return this.x === other.x && this.y === other.y && this.z === other.z; }
  set(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  copy(other: Vec3): this { this.x = other.x; this.y = other.y; this.z = other.z; return this; }
  toString(precision: number = 2): string {
    return `(${this.x.toFixed(precision)}, ${this.y.toFixed(precision)}, ${this.z.toFixed(precision)})`;
  }
  static zero(): Vec3 { return new Vec3(0, 0, 0); }
  static one(): Vec3 { return new Vec3(1, 1, 1); }
  static up(): Vec3 { return new Vec3(0, 1, 0); }
}
