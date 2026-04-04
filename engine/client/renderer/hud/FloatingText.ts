import * as THREE from 'three';
import { HudElement } from './HudElement';

export class FloatingText extends HudElement {
  private _canvas: HTMLCanvasElement | null = null;
  private _texture: THREE.CanvasTexture | null = null;
  private _mesh: THREE.Sprite | null = null;
  private _lifetime: number;
  private _elapsed = 0;
  private _speed: number;

  constructor(text: string, options: { color?: string; fontSize?: number; lifetime?: number; speed?: number } = {}) {
    super();
    this._lifetime = options.lifetime ?? 1500;
    this._speed = options.speed ?? 30;

    // Create text using canvas
    if (typeof document !== 'undefined') {
      this._canvas = document.createElement('canvas');
      const ctx = this._canvas.getContext('2d')!;
      const fontSize = options.fontSize ?? 16;
      ctx.font = `bold ${fontSize}px Arial`;
      const metrics = ctx.measureText(text);
      this._canvas.width = Math.ceil(metrics.width) + 4;
      this._canvas.height = fontSize + 4;
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.fillStyle = options.color ?? '#ffffff';
      ctx.fillText(text, 2, fontSize);

      this._texture = new THREE.CanvasTexture(this._canvas);
      const mat = new THREE.SpriteMaterial({ map: this._texture, transparent: true });
      this._mesh = new THREE.Sprite(mat);
      this._mesh.scale.set(this._canvas.width, this._canvas.height, 1);
      this.group.add(this._mesh);
    }
  }

  get isExpired(): boolean { return this._elapsed >= this._lifetime; }

  update(dt: number): void {
    this._elapsed += dt;
    // Float upward
    this.group.position.y += this._speed * (dt / 1000);
    // Fade out
    if (this._mesh) {
      const t = this._elapsed / this._lifetime;
      (this._mesh.material as THREE.SpriteMaterial).opacity = 1 - t;
    }
  }

  destroy(): void {
    this._texture?.dispose();
    if (this._mesh) {
      (this._mesh.material as THREE.SpriteMaterial).dispose();
    }
    this.group.removeFromParent();
  }
}
