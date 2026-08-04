import { describe, it, expect, beforeEach } from 'vitest';
import { RegionLayer } from '../../../engine/client/renderer/RegionLayer';

class V3 { x=0; y=0; z=0; set(x:number,y:number,z:number){this.x=x;this.y=y;this.z=z;return this;} copy(o:any){this.x=o.x;this.y=o.y;this.z=o.z;return this;} }
class Obj { parent:Obj|null=null; children:Obj[]=[]; position=new V3(); rotation=new V3(); scale=new V3(); visible=true; name=''; userData:any={};
  add(c:Obj){c.parent=this;this.children.push(c);} remove(c:Obj){const i=this.children.indexOf(c);if(i>=0){this.children.splice(i,1);c.parent=null;}}
  removeFromParent(){this.parent?.remove(this);} traverse(f:(o:Obj)=>void){f(this);this.children.forEach(c=>c.traverse(f));} }
const FakeTHREE: any = {
  Group: Obj, Object3D: Obj, Mesh: class extends Obj {}, LineLoop: class extends Obj {}, Sprite: class extends Obj {},
  PlaneGeometry: class { dispose(){} }, BufferGeometry: class { setFromPoints(){return this;} dispose(){} },
  MeshBasicMaterial: class { constructor(public o:any={}){} color={set(){}}; opacity=1; dispose(){} },
  LineBasicMaterial: class { constructor(public o:any={}){} color={set(){}}; opacity=1; transparent=false; dispose(){} },
  SpriteMaterial: class { constructor(public o:any={}){} dispose(){} },
  CanvasTexture: class { constructor(){} dispose(){} needsUpdate=false },
  Vector3: V3, Color: class { constructor(public v?:any){} set(v:any){this.v=v;return this;} },
  DoubleSide: 2,
};
// jsdom provides document.createElement('canvas'); getContext may be null → RegionLayer must guard.

describe('RegionLayer CRUD', () => {
  let layer: RegionLayer;
  beforeEach(() => { layer = new RegionLayer(FakeTHREE); });

  it('upsert creates a region and getById/list reflect it', () => {
    layer.upsert('spawn', { x: 1, y: 2, width: 3, height: 4, color: '#ff0000', alpha: 0.5 });
    expect(layer.getById('spawn')).toMatchObject({ id: 'spawn', x: 1, y: 2, width: 3, height: 4 });
    expect(layer.list().map(r => r.id)).toEqual(['spawn']);
    expect(layer.group.children.length).toBe(1);
  });

  it('upsert updates in place (no duplicate object)', () => {
    layer.upsert('a', { x: 0, y: 0, width: 1, height: 1, color: '#0f0', alpha: 1 });
    layer.upsert('a', { x: 5, y: 6, width: 2, height: 2, color: '#0f0', alpha: 1 });
    expect(layer.group.children.length).toBe(1);
    expect(layer.getById('a')).toMatchObject({ x: 5, y: 6, width: 2, height: 2 });
  });

  it('rename moves the record id, keeps geometry', () => {
    layer.upsert('old', { x: 1, y: 1, width: 1, height: 1, color: '#0f0', alpha: 1 });
    layer.rename('old', 'new');
    expect(layer.getById('old')).toBeNull();
    expect(layer.getById('new')).toMatchObject({ id: 'new', x: 1, y: 1 });
    expect(layer.group.children.length).toBe(1);
  });

  it('delete removes record and object', () => {
    layer.upsert('z', { x: 0, y: 0, width: 1, height: 1, color: '#0f0', alpha: 1 });
    layer.delete('z');
    expect(layer.getById('z')).toBeNull();
    expect(layer.group.children.length).toBe(0);
  });

  it('setVisible toggles the group', () => {
    layer.setVisible(false);
    expect(layer.group.visible).toBe(false);
    layer.setVisible(true);
    expect(layer.group.visible).toBe(true);
  });
});

describe('RegionLayer editor preview opacity', () => {
  it('fill stays a faint tint regardless of region alpha; border is prominent', () => {
    const layer = new RegionLayer(FakeTHREE);
    // a full-map region with gameplay alpha 1 must NOT paint an opaque sheet
    layer.upsert('entire map region', { x: 0, y: 0, width: 65, height: 64, color: '#00ff00', alpha: 1 });
    const grp: any = layer.group.children[0];
    const fill: any = grp.children[0];
    const border: any = grp.children[1];
    expect(fill.material.opacity).toBeGreaterThan(0);
    expect(fill.material.opacity).toBeLessThanOrEqual(0.25);
    expect(border.material.opacity).toBeGreaterThanOrEqual(0.8);
    expect(border.material.transparent).toBe(true);

    // alpha:0 region is still faintly visible/selectable in the editor
    layer.upsert('z', { x: 0, y: 0, width: 1, height: 1, color: '#00ff00', alpha: 0 });
    const f2: any = layer.group.children[1].children[0];
    expect(f2.material.opacity).toBeGreaterThan(0);
    expect(f2.material.opacity).toBeLessThanOrEqual(0.25);

    // gameplay alpha is still preserved on the record (round-trips to the modal)
    expect(layer.getById('entire map region')!.alpha).toBe(1);
  });
});

describe('RegionLayer hit-testing & transform', () => {
  let layer: RegionLayer;
  beforeEach(() => {
    layer = new RegionLayer(FakeTHREE);
    layer.upsert('r', { x: 10, y: 10, width: 20, height: 10, color: '#0f0', alpha: 1 });
  });

  it('hitTest returns id when point inside, null when outside', () => {
    expect(layer.hitTest(15, 12)).toBe('r');
    expect(layer.hitTest(0, 0)).toBeNull();
  });

  it('hitTest returns topmost (last-added) region on overlap', () => {
    layer.upsert('top', { x: 12, y: 11, width: 5, height: 5, color: '#0f0', alpha: 1 });
    expect(layer.hitTest(13, 12)).toBe('top');
  });

  it('getMesh returns the fill mesh for the id (null if missing)', () => {
    const mesh = layer.getMesh('r');
    expect(mesh).toBeTruthy();
    expect(mesh.position).toBeDefined();
    expect(layer.getMesh('does-not-exist')).toBeNull();
  });

  it('setSelected tracks the selected id and survives rename', () => {
    layer.setSelected('r');
    expect(layer.getSelectedId()).toBe('r');
    layer.rename('r', 'r2');
    expect(layer.getSelectedId()).toBe('r2');
    layer.setSelected(null);
    expect(layer.getSelectedId()).toBeNull();
  });

  it('delete clears selection if the deleted id was selected', () => {
    layer.setSelected('r');
    layer.delete('r');
    expect(layer.getSelectedId()).toBeNull();
  });
});
