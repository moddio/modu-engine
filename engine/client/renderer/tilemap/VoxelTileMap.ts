import * as THREE from 'three';
import { TilesetLookup, TilesetDef } from './TilesetLoader';
import { buildChunkGeometry } from './TileChunk';

const CHUNK_SIZE = 16;
const SCALE_RATIO = 64;

function pixelToWorld(px: number): number { return px / SCALE_RATIO; }

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
}

export class VoxelTileMap {
  readonly group = new THREE.Group();
  private _meshes: THREE.Mesh[] = [];
  private _tilesetTextures = new Map<string, THREE.Texture>();

  async load(map: TiledMap): Promise<void> {
    const { width: mapW, height: mapH, tilewidth: tw, tileheight: th } = map;
    const worldTileW = pixelToWorld(tw);
    const worldTileH = pixelToWorld(th);

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
        texture.colorSpace = THREE.SRGBColorSpace;
        this._tilesetTextures.set(ts.image, texture);
      } catch { continue; }

      const cols = ts.columns || Math.floor(ts.imagewidth / ts.tilewidth);
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
      });
    }

    if (tilesetDefs.length === 0) return;
    const lookup = new TilesetLookup(tilesetDefs);

    // Use first tileset texture as primary
    const sortedByGid = [...tilesetDefs].sort((a, b) => a.firstgid - b.firstgid);
    const primaryTexture = this._tilesetTextures.get(sortedByGid[0]?.image ?? '');
    if (!primaryTexture) return;

    // Render each tile layer
    for (let li = 0; li < map.layers.length; li++) {
      const layer = map.layers[li];
      if (layer.type !== 'tilelayer' || !layer.data) continue;
      if (layer.visible === false) continue;

      const chunksX = Math.ceil(mapW / CHUNK_SIZE);
      const chunksY = Math.ceil(mapH / CHUNK_SIZE);

      for (let cy = 0; cy < chunksY; cy++) {
        for (let cx = 0; cx < chunksX; cx++) {
          const chunkW = Math.min(CHUNK_SIZE, mapW - cx * CHUNK_SIZE);
          const chunkH = Math.min(CHUNK_SIZE, mapH - cy * CHUNK_SIZE);
          const chunkTiles: number[] = [];

          for (let y = 0; y < chunkH; y++) {
            for (let x = 0; x < chunkW; x++) {
              const mapX = cx * CHUNK_SIZE + x;
              const mapY = cy * CHUNK_SIZE + y;
              chunkTiles.push(layer.data[mapY * mapW + mapX]);
            }
          }

          const geo = buildChunkGeometry(chunkTiles, chunkW, chunkH, worldTileW, worldTileH, (gid) => lookup.getUV(gid));
          if (geo.positions.length === 0) continue;

          const bufGeo = new THREE.BufferGeometry();
          bufGeo.setAttribute('position', new THREE.Float32BufferAttribute(geo.positions, 3));
          bufGeo.setAttribute('uv', new THREE.Float32BufferAttribute(geo.uvs, 2));
          bufGeo.setAttribute('normal', new THREE.Float32BufferAttribute(geo.normals, 3));
          bufGeo.setIndex(geo.indices);

          const material = new THREE.MeshBasicMaterial({
            map: primaryTexture,
            transparent: true,
            alphaTest: 0.1,
            depthWrite: li === 0,
            side: THREE.DoubleSide,
          });

          const mesh = new THREE.Mesh(bufGeo, material);
          const offsetX = cx * CHUNK_SIZE * worldTileW;
          const offsetZ = cy * CHUNK_SIZE * worldTileH;
          mesh.position.set(offsetX, li * 0.01, offsetZ);
          mesh.name = `chunk_${layer.name}_${cx}_${cy}`;

          this.group.add(mesh);
          this._meshes.push(mesh);
        }
      }
    }
  }

  getWorldSize(map: TiledMap): { width: number; height: number } {
    return {
      width: pixelToWorld(map.width * map.tilewidth),
      height: pixelToWorld(map.height * map.tileheight),
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
}
