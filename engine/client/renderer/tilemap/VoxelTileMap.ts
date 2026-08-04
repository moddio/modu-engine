import * as THREE from 'three';
import { TilesetLookup, TilesetDef, isTileBlank } from './TilesetLoader';
import { buildChunkGeometry } from './TileChunk';

const CHUNK_SIZE = 16;

// In the taro 3D engine, each tile = 1 world unit (not tilewidth/64)
// This matches how props and entities are positioned (1 unit = 1 tile)

export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

export interface TiledLayer {
  name: string;
  type: string;
  data?: number[];
  width: number;
  height: number;
  visible?: boolean;
  opacity?: number;
}

export interface TiledTileset {
  firstgid: number;
  name?: string;
  image: string;
  imagewidth: number;
  imageheight: number;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  spacing?: number;
  margin?: number;
}

export class VoxelTileMap {
  readonly group = new THREE.Group();
  private _meshes: THREE.Mesh[] = [];
  private _tilesetTextures = new Map<string, THREE.Texture>();
  /** GIDs whose atlas tile is entirely transparent. Emitting voxel geometry for them
   *  is pure cost and pure risk: nothing can ever be drawn, yet the quads still
   *  rasterize, and at grazing angles UV interpolation drifts off the tile and samples
   *  a neighbouring one. Braains3D's full-map "glass ceiling" layer is 1995 tiles of a
   *  100%-transparent GID, which is what scattered grass-green and pavement speckles
   *  across the sky whenever the camera dropped toward the horizon. */
  private _blankGids = new Set<number>();

  async load(map: TiledMap): Promise<void> {
    const { width: mapW, height: mapH } = map;
    // Each tile = 1 world unit (matching taro Voxels.ts where tile at x,z occupies x+0.5, z+0.5)
    const worldTileW = 1;
    const worldTileH = 1;

    // Load tileset textures
    const loader = new THREE.TextureLoader();
    const tilesetDefs: TilesetDef[] = [];

    for (const ts of map.tilesets) {
      if (!ts.image) continue;
      try {
        const texture = await new Promise<THREE.Texture>((resolve, reject) => {
          loader.load(ts.image, resolve, undefined, reject);
        });
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        this._tilesetTextures.set(ts.image, texture);
      } catch { continue; }

      const spacing = (ts as any).spacing ?? 0;
      const margin = (ts as any).margin ?? 0;
      const cols = ts.columns || Math.floor((ts.imagewidth - 2 * margin + spacing) / (ts.tilewidth + spacing));
      console.log('[VoxelTileMap] tileset:', ts.name, 'spacing:', spacing, 'margin:', margin, 'cols:', cols, 'image:', ts.imagewidth, 'x', ts.imageheight, 'tile:', ts.tilewidth, 'x', ts.tileheight);
      tilesetDefs.push({
        firstgid: ts.firstgid || 1,
        columns: cols,
        tilecount: ts.tilecount,
        tilewidth: ts.tilewidth,
        tileheight: ts.tileheight,
        imagewidth: ts.imagewidth,
        imageheight: ts.imageheight,
        image: ts.image,
        name: ts.name,
        spacing,
        margin,
      });
      this._collectBlankGids(tilesetDefs[tilesetDefs.length - 1], this._tilesetTextures.get(ts.image)?.image);
    }

    if (tilesetDefs.length === 0) return;
    const lookup = new TilesetLookup(tilesetDefs);

    // Use first tileset texture as primary
    const sortedByGid = [...tilesetDefs].sort((a, b) => a.firstgid - b.firstgid);
    const primaryTexture = this._tilesetTextures.get(sortedByGid[0]?.image ?? '');
    if (!primaryTexture) return;

    // Render each tile layer
    let tileLayerIndex = 0;
    for (let li = 0; li < map.layers.length; li++) {
      const layer = map.layers[li];
      if (layer.type !== 'tilelayer' || !layer.data) continue;
      if (layer.visible === false) continue;

      const chunksX = Math.ceil(mapW / CHUNK_SIZE);
      const chunksY = Math.ceil(mapH / CHUNK_SIZE);
      const layerY = -0.501 + tileLayerIndex;

      for (let cy = 0; cy < chunksY; cy++) {
        for (let cx = 0; cx < chunksX; cx++) {
          const chunkW = Math.min(CHUNK_SIZE, mapW - cx * CHUNK_SIZE);
          const chunkH = Math.min(CHUNK_SIZE, mapH - cy * CHUNK_SIZE);
          const chunkTiles: number[] = [];

          for (let y = 0; y < chunkH; y++) {
            for (let x = 0; x < chunkW; x++) {
              const mapX = cx * CHUNK_SIZE + x;
              const mapY = cy * CHUNK_SIZE + y;
              const gid = layer.data[mapY * mapW + mapX];
              chunkTiles.push(this._blankGids.has(gid) ? 0 : gid);
            }
          }

          const geo = buildChunkGeometry(chunkTiles, chunkW, chunkH, worldTileW, worldTileH, (gid) => lookup.getUV(gid));
          if (geo.positions.length === 0) continue;

          const bufGeo = new THREE.BufferGeometry();
          bufGeo.setAttribute('position', new THREE.Float32BufferAttribute(geo.positions, 3));
          bufGeo.setAttribute('uv', new THREE.Float32BufferAttribute(geo.uvs, 2));
          bufGeo.setAttribute('normal', new THREE.Float32BufferAttribute(geo.normals, 3));
          bufGeo.setIndex(geo.indices);

          const material = new THREE.MeshStandardMaterial({
            map: primaryTexture,
            transparent: false,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
          });

          const mesh = new THREE.Mesh(bufGeo, material);
          const offsetX = cx * CHUNK_SIZE * worldTileW;
          const offsetZ = cy * CHUNK_SIZE * worldTileH;
          mesh.position.set(offsetX, layerY, offsetZ);
          mesh.name = `chunk_${layer.name}_${cx}_${cy}`;
          mesh.receiveShadow = true;

          this.group.add(mesh);
          this._meshes.push(mesh);
        }
      }
      tileLayerIndex++;
    }
  }

  getWorldSize(map: TiledMap): { width: number; height: number } {
    // 1 tile = 1 world unit
    return {
      width: map.width,
      height: map.height,
    };
  }

  dispose(): void {
    for (const mesh of this._meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshBasicMaterial).dispose();
      mesh.removeFromParent();
    }
    this._meshes = [];
    for (const tex of this._tilesetTextures.values()) tex.dispose();
    this._tilesetTextures.clear();
    this.group.removeFromParent();
  }
  /**
   * Scan a tileset atlas once and record which tiles are fully transparent.
   *
   * Alpha 128 is the cut-off so this matches the chunk material's `alphaTest: 0.5`:
   * a tile whose every texel would be discarded by the shader can never contribute a
   * pixel, so it should not become geometry in the first place.
   *
   * Degrades silently. `getImageData` throws on a cross-origin atlas (modd.io serves
   * tilesets from cache.modd.io), and there is no canvas at all under Node; in either
   * case the set stays empty and every tile renders exactly as before.
   */
  private _collectBlankGids(def: TilesetDef | undefined, image: unknown): void {
    if (!def || !image || typeof document === 'undefined') return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = def.imagewidth;
      canvas.height = def.imageheight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(image as CanvasImageSource, 0, 0);

      const margin = def.margin ?? 0;
      const spacing = def.spacing ?? 0;
      const rows = Math.floor((def.imageheight - 2 * margin + spacing) / (def.tileheight + spacing));
      const count = def.tilecount || def.columns * rows;
      for (let local = 0; local < count; local++) {
        const col = local % def.columns;
        const row = Math.floor(local / def.columns);
        const x = margin + col * (def.tilewidth + spacing);
        const y = margin + row * (def.tileheight + spacing);
        if (x + def.tilewidth > def.imagewidth || y + def.tileheight > def.imageheight) continue;
        const data = ctx.getImageData(x, y, def.tilewidth, def.tileheight).data;
        if (isTileBlank(data)) this._blankGids.add(def.firstgid + local);
      }
    } catch {
      // Cross-origin atlas or no 2D context — leave every tile renderable.
    }
  }

}
