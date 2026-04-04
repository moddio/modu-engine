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
    this.values[2] += x;
    this.values[5] += y;
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
    this.values[0] = cos;  this.values[1] = -sin;
    this.values[3] = sin;  this.values[4] = cos;
    return this;
  }

  scaleBy(x: number, y: number): this {
    this.values[0] *= x;
    this.values[1] *= y;
    this.values[3] *= x;
    this.values[4] *= y;
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
    a[0] = a0*b[0] + a1*b[3] + a2*b[6];
    a[1] = a0*b[1] + a1*b[4] + a2*b[7];
    a[2] = a0*b[2] + a1*b[5] + a2*b[8];
    a[3] = a3*b[0] + a4*b[3] + a5*b[6];
    a[4] = a3*b[1] + a4*b[4] + a5*b[7];
    a[5] = a3*b[2] + a4*b[5] + a5*b[8];
    a[6] = a6*b[0] + a7*b[3] + a8*b[6];
    a[7] = a6*b[1] + a7*b[4] + a8*b[7];
    a[8] = a6*b[2] + a7*b[5] + a8*b[8];
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
    const det = v[0]*(v[4]*v[8] - v[5]*v[7]) - v[1]*(v[3]*v[8] - v[5]*v[6]) + v[2]*(v[3]*v[7] - v[4]*v[6]);
    if (det === 0) return null;
    const invDet = 1 / det;
    const inv = new Matrix2d();
    const r = inv.values;
    r[0] = (v[4]*v[8] - v[5]*v[7]) * invDet;
    r[1] = (v[2]*v[7] - v[1]*v[8]) * invDet;
    r[2] = (v[1]*v[5] - v[2]*v[4]) * invDet;
    r[3] = (v[5]*v[6] - v[3]*v[8]) * invDet;
    r[4] = (v[0]*v[8] - v[2]*v[6]) * invDet;
    r[5] = (v[2]*v[3] - v[0]*v[5]) * invDet;
    r[6] = (v[3]*v[7] - v[4]*v[6]) * invDet;
    r[7] = (v[1]*v[6] - v[0]*v[7]) * invDet;
    r[8] = (v[0]*v[4] - v[1]*v[3]) * invDet;
    return inv;
  }

  copy(other: Matrix2d): this {
    for (let i = 0; i < 9; i++) this.values[i] = other.values[i];
    return this;
  }

  compare(other: Matrix2d): boolean {
    for (let i = 0; i < 9; i++) { if (this.values[i] !== other.values[i]) return false; }
    return true;
  }

  clone(): Matrix2d {
    const m = new Matrix2d();
    m.copy(this);
    return m;
  }
}
