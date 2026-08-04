import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockRenderer } from '../../_helpers/mockRenderer';

vi.mock('../../../engine/client/renderer/Renderer', () => ({
  Renderer: createMockRenderer(),
}));

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
