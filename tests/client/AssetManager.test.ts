import { describe, it, expect, beforeEach } from 'vitest';
import { AssetManager, AssetSource } from '../../engine/client/renderer/AssetManager';

describe('AssetManager', () => {
  let manager: AssetManager;

  beforeEach(() => {
    manager = new AssetManager();
  });

  describe('texture registry', () => {
    it('starts empty', () => {
      expect(manager.getTexture('nonexistent')).toBeNull();
    });

    it('tracks loading state', () => {
      expect(manager.isLoading).toBe(false);
    });
  });

  describe('source registration', () => {
    it('registers asset sources', () => {
      const sources: AssetSource[] = [
        { name: 'tileset1', type: 'texture', url: 'https://example.com/tileset.png' },
        { name: 'model1', type: 'gltf', url: 'https://example.com/model.glb' },
      ];
      manager.registerSources(sources);
      expect(manager.sourceCount).toBe(2);
    });

    it('does not duplicate sources with same name', () => {
      const source: AssetSource = { name: 'tex', type: 'texture', url: 'https://example.com/tex.png' };
      manager.registerSources([source]);
      manager.registerSources([source]);
      expect(manager.sourceCount).toBe(1);
    });
  });

  describe('filter configuration', () => {
    it('defaults to nearest filter', () => {
      expect(manager.defaultFilter).toBe('nearest');
    });

    it('can be set to linear', () => {
      manager.defaultFilter = 'linear';
      expect(manager.defaultFilter).toBe('linear');
    });
  });

  describe('dispose', () => {
    it('clears all sources and textures', () => {
      manager.registerSources([{ name: 'tex', type: 'texture', url: 'https://example.com/tex.png' }]);
      expect(manager.sourceCount).toBe(1);
      manager.dispose();
      expect(manager.sourceCount).toBe(0);
    });
  });
});
