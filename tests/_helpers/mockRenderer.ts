import { vi } from 'vitest';
import * as THREE from 'three';

/**
 * Factory used inside `vi.mock(...)` to stub `Renderer` for vitest's node
 * environment. Returns a class whose `.scene` is a real `THREE.Scene`, so
 * scene-graph assertions exercise real Three.js. Only WebGL-dependent surface
 * is stubbed (the `THREE.WebGLRenderer` constructor reads `document` which
 * does not exist in node).
 *
 * Usage:
 *   vi.mock('../../../engine/client/renderer/Renderer', () => ({
 *     Renderer: createMockRenderer(),
 *   }));
 */
export function createMockRenderer(): new () => unknown {
  return class MockRenderer {
    readonly scene = new THREE.Scene();
    readonly events = { emit: vi.fn() };
    readonly threeRenderer = { dispose: vi.fn(), setSize: vi.fn(), render: vi.fn() };
    width = 800;
    height = 600;
    get canvas() { return null; }
    resize = vi.fn();
    render = vi.fn();
    destroy = vi.fn();
  };
}
