import * as THREE from 'three';

export interface SheetFrame {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class TextureSheet {
  readonly texture: THREE.Texture;
  readonly width: number;
  readonly height: number;
  private _frames = new Map<string, SheetFrame>();

  constructor(texture: THREE.Texture, width: number, height: number) {
    this.texture = texture;
    this.width = width;
    this.height = height;
    // Prevent texture filtering artifacts at tile edges
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
  }

  addFrame(frame: SheetFrame): void {
    this._frames.set(frame.name, frame);
  }

  getFrame(name: string): SheetFrame | undefined {
    return this._frames.get(name);
  }

  getUVRect(name: string): { offsetX: number; offsetY: number; repeatX: number; repeatY: number } | undefined {
    const frame = this._frames.get(name);
    if (!frame) return undefined;
    return {
      offsetX: frame.x / this.width,
      offsetY: 1 - (frame.y + frame.height) / this.height,
      repeatX: frame.width / this.width,
      repeatY: frame.height / this.height,
    };
  }

  get frameCount(): number { return this._frames.size; }
}
