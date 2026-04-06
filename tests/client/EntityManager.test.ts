import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EntityManager } from '../../engine/client/renderer/EntityManager';
import { UnitRenderer } from '../../engine/client/renderer/entities/UnitRenderer';

describe('EntityManager', () => {
  let manager: EntityManager;

  beforeEach(() => {
    manager = new EntityManager();
  });

  it('starts empty', () => {
    expect(manager.count).toBe(0);
  });

  it('add() registers an entity and adds group to scene', () => {
    const unit = new UnitRenderer();
    manager.add('unit1', unit);
    expect(manager.count).toBe(1);
    expect(manager.get('unit1')).toBe(unit);
    expect(manager.group.children).toContain(unit.group);
  });

  it('get() returns undefined for missing entity', () => {
    expect(manager.get('missing')).toBeUndefined();
  });

  it('remove() destroys and removes entity', () => {
    const unit = new UnitRenderer();
    const destroySpy = vi.spyOn(unit, 'destroy');
    manager.add('unit1', unit);
    manager.remove('unit1');
    expect(manager.count).toBe(0);
    expect(manager.get('unit1')).toBeUndefined();
    expect(destroySpy).toHaveBeenCalled();
  });

  it('remove() is a no-op for missing id', () => {
    manager.remove('nonexistent');
    expect(manager.count).toBe(0);
  });

  it('update() calls update on all entities', () => {
    const unit1 = new UnitRenderer();
    const unit2 = new UnitRenderer();
    const spy1 = vi.spyOn(unit1, 'update');
    const spy2 = vi.spyOn(unit2, 'update');

    manager.add('u1', unit1);
    manager.add('u2', unit2);
    manager.update(16);

    expect(spy1).toHaveBeenCalledWith(16);
    expect(spy2).toHaveBeenCalledWith(16);
  });

  it('update() calls faceCamera on billboard sprites', () => {
    const unit = new UnitRenderer();
    unit.sprite.billboard = true;
    const faceSpy = vi.spyOn(unit.sprite, 'faceCamera');

    manager.add('u1', unit);
    const mockCamera = { quaternion: { x: 0, y: 0, z: 0, w: 1 } } as any;
    manager.update(16, mockCamera);

    expect(faceSpy).toHaveBeenCalledWith(mockCamera);
  });

  it('update() does not call faceCamera when billboard is false', () => {
    const unit = new UnitRenderer();
    unit.sprite.billboard = false;
    const faceSpy = vi.spyOn(unit.sprite, 'faceCamera');

    manager.add('u1', unit);
    const mockCamera = { quaternion: { x: 0, y: 0, z: 0, w: 1 } } as any;
    manager.update(16, mockCamera);

    expect(faceSpy).not.toHaveBeenCalled();
  });

  it('clear() destroys all entities', () => {
    const unit1 = new UnitRenderer();
    const unit2 = new UnitRenderer();
    const spy1 = vi.spyOn(unit1, 'destroy');
    const spy2 = vi.spyOn(unit2, 'destroy');

    manager.add('u1', unit1);
    manager.add('u2', unit2);
    manager.clear();

    expect(manager.count).toBe(0);
    expect(spy1).toHaveBeenCalled();
    expect(spy2).toHaveBeenCalled();
  });
});
