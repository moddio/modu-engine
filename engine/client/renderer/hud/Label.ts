import * as THREE from 'three';
import { HudElement } from './HudElement';

export class Label extends HudElement {
  private _canvas: HTMLCanvasElement | null = null;
  private _texture: THREE.CanvasTexture | null = null;
  private _mesh: THREE.Sprite | null = null;
  private _text = '';

  constructor(text: string = '', options: { color?: string; fontSize?: number } = {}) {
    super();
    this._text = text;
    if (typeof document !== 'undefined') {
      this._canvas = document.createElement('canvas');
      this._renderText(text, options.color ?? '#ffffff', options.fontSize ?? 14);
    }
  }

  setText(text: string, color: string = '#ffffff', fontSize: number = 14): void {
    this._text = text;
    this._renderText(text, color, fontSize);
  }

  get text(): string { return this._text; }

  private _renderText(text: string, color: string, fontSize: number): void {
    if (!this._canvas) return;
    const ctx = this._canvas.getContext('2d')!;
    ctx.font = `${fontSize}px Arial`;
    const metrics = ctx.measureText(text);
    this._canvas.width = Math.ceil(metrics.width) + 4;
    this._canvas.height = fontSize + 4;
    ctx.font = `${fontSize}px Arial`;
    ctx.fillStyle = color;
    ctx.fillText(text, 2, fontSize);

    if (this._texture) this._texture.dispose();
    this._texture = new THREE.CanvasTexture(this._canvas);

    if (this._mesh) {
      (this._mesh.material as THREE.SpriteMaterial).map = this._texture;
      (this._mesh.material as THREE.SpriteMaterial).needsUpdate = true;
    } else {
      const mat = new THREE.SpriteMaterial({ map: this._texture, transparent: true });
      this._mesh = new THREE.Sprite(mat);
      this.group.add(this._mesh);
    }
    this._mesh.scale.set(this._canvas.width, this._canvas.height, 1);
  }

  update(_dt: number): void {}

  destroy(): void {
    this._texture?.dispose();
    if (this._mesh) (this._mesh.material as THREE.SpriteMaterial).dispose();
    this.group.removeFromParent();
  }
}
