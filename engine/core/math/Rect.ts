import { Vec2 } from './Vec2';
export class Rect {
  constructor(public x: number = 0, public y: number = 0, public width: number = 0, public height: number = 0) {}
  containsPoint(point: Vec2): boolean { return point.x >= this.x && point.x <= this.x + this.width && point.y >= this.y && point.y <= this.y + this.height; }
  containsXY(x: number, y: number): boolean { return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height; }
  intersects(other: Rect): boolean { return this.x <= other.x + other.width && this.x + this.width >= other.x && this.y <= other.y + other.height && this.y + this.height >= other.y; }
  combine(other: Rect): Rect { const x = Math.min(this.x, other.x); const y = Math.min(this.y, other.y); return new Rect(x, y, Math.max(this.x+this.width, other.x+other.width)-x, Math.max(this.y+this.height, other.y+other.height)-y); }
  clone(): Rect { return new Rect(this.x, this.y, this.width, this.height); }
  equals(other: Rect): boolean { return this.x === other.x && this.y === other.y && this.width === other.width && this.height === other.height; }
  toString(): string { return `Rect(${this.x}, ${this.y}, ${this.width}, ${this.height})`; }
}
