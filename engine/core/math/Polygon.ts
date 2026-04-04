import { Vec2 } from './Vec2';
import { Rect } from './Rect';

export class Polygon {
  vertices: Vec2[];

  constructor(vertices: Vec2[] = []) { this.vertices = vertices; }

  addVertex(point: Vec2): this { this.vertices.push(point); return this; }
  vertexCount(): number { return this.vertices.length; }

  containsPoint(point: Vec2): boolean {
    const verts = this.vertices;
    const n = verts.length;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const vi = verts[i], vj = verts[j];
      if ((vi.y > point.y) !== (vj.y > point.y) &&
          point.x < ((vj.x - vi.x) * (point.y - vi.y)) / (vj.y - vi.y) + vi.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  aabb(): Rect {
    if (this.vertices.length === 0) return new Rect(0, 0, 0, 0);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of this.vertices) {
      if (v.x < minX) minX = v.x; if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x; if (v.y > maxY) maxY = v.y;
    }
    return new Rect(minX, minY, maxX - minX, maxY - minY);
  }

  clone(): Polygon { return new Polygon(this.vertices.map(v => v.clone())); }
}
