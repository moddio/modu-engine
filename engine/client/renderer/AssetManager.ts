import * as THREE from 'three';

export interface AssetSource {
  name: string;
  type: 'texture' | 'gltf';
  url: string;
  filter?: 'nearest' | 'linear';
}

export class AssetManager {
  private _textures = new Map<string, THREE.Texture>();
  private _sources = new Map<string, AssetSource>();
  private _loading = false;
  private _textureLoader: THREE.TextureLoader | null = null;
  defaultFilter: 'nearest' | 'linear' = 'nearest';

  get sourceCount(): number { return this._sources.size; }
  get isLoading(): boolean { return this._loading; }

  registerSources(sources: AssetSource[]): void {
    for (const source of sources) {
      this._sources.set(source.name, source);
    }
  }

  getTexture(name: string): THREE.Texture | null {
    return this._textures.get(name) ?? null;
  }

  async loadTexture(url: string, name?: string): Promise<THREE.Texture> {
    const key = name ?? url;
    const cached = this._textures.get(key);
    if (cached) return cached;

    if (!this._textureLoader) {
      this._textureLoader = new THREE.TextureLoader();
    }

    return new Promise((resolve, reject) => {
      this._textureLoader!.load(
        url,
        (texture) => {
          const filter = this.defaultFilter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
          texture.magFilter = filter;
          texture.minFilter = filter;
          texture.colorSpace = THREE.SRGBColorSpace;
          this._textures.set(key, texture);
          resolve(texture);
        },
        undefined,
        reject,
      );
    });
  }

  async loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async loadAll(): Promise<void> {
    this._loading = true;
    const promises: Promise<void>[] = [];
    for (const source of this._sources.values()) {
      if (source.type === 'texture') {
        promises.push(this.loadTexture(source.url, source.name).then(() => {}));
      }
    }
    await Promise.allSettled(promises);
    this._loading = false;
  }

  dispose(): void {
    for (const texture of this._textures.values()) {
      texture.dispose();
    }
    this._textures.clear();
    this._sources.clear();
  }
}
