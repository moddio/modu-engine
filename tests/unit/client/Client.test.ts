import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

// Mock WebGLRenderer before importing Client, so that new Renderer() does not
// throw "document is not defined" in the node vitest environment.
vi.mock('../../../engine/client/renderer/Renderer', () => {
  return {
    Renderer: class MockRenderer {
      readonly scene = new THREE.Scene();
      readonly events = { emit: vi.fn() };
      readonly threeRenderer = { dispose: vi.fn(), setSize: vi.fn(), render: vi.fn() };
      width = 800;
      height = 600;
      get canvas() { return null; }
      resize = vi.fn();
      render = vi.fn();
      destroy = vi.fn();
    },
  };
});

import { Client } from '../../../engine/client/Client';
import { EntityManager } from '../../../engine/client/renderer/EntityManager';
import { Engine } from '../../../engine/core/Engine';

describe('Client', () => {
  beforeEach(() => {
    Engine.reset();
  });

  it('exposes an EntityManager instance', () => {
    const client = new Client();
    expect(client.entityManager).toBeInstanceOf(EntityManager);
  });

  it('adds entityManager.group to the renderer scene', () => {
    const client = new Client();
    expect(client.renderer.scene.children).toContain(client.entityManager.group);
  });
});
