import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockRenderer } from '../../_helpers/mockRenderer';

vi.mock('../../../engine/client/renderer/Renderer', () => ({
  Renderer: createMockRenderer(),
}));

import { EditorIntegration } from '../../../engine/client/EditorIntegration';
import { Client } from '../../../engine/client/Client';
import { GameLoader } from '../../../engine/core/GameLoader';
import { Engine } from '../../../engine/core/Engine';

describe('EditorIntegration', () => {
  beforeEach(() => {
    Engine.reset();
  });

  it('changeTab on devMode triggers map-tab side-effects via MapTabController', () => {
    const client = new Client();
    const gameLoader = new GameLoader();
    const integration = new EditorIntegration(client, gameLoader);
    const visSpy = vi.spyOn(client.entityManager, 'setRuntimeEntitiesVisible');
    integration.devMode.changeTab('map');
    expect(visSpy).toHaveBeenCalledWith(false);
  });

  it('dispose() detaches MapTabController so further tab changes are ignored', () => {
    const client = new Client();
    const gameLoader = new GameLoader();
    const integration = new EditorIntegration(client, gameLoader);
    integration.dispose();
    const visSpy = vi.spyOn(client.entityManager, 'setRuntimeEntitiesVisible');
    integration.devMode.changeTab('map');
    expect(visSpy).not.toHaveBeenCalled();
  });

  describe('expose()', () => {
    let originalWindow: typeof globalThis.window | undefined;

    beforeEach(() => {
      originalWindow = (globalThis as any).window;
      (globalThis as any).window = {};
    });

    afterEach(() => {
      if (originalWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = originalWindow;
      }
    });

    it('populates window.modu with engine, events, editor, and network from client', () => {
      const client = new Client();
      const gameLoader = new GameLoader();
      const integration = new EditorIntegration(client, gameLoader);
      integration.expose();

      const modu = (globalThis as any).window.modu;
      expect(modu.engine).toBe(client.engine);
      expect(modu.events).toBe(client.engine.events);
      expect(modu.editor).toBe(integration.devMode);
      expect(typeof modu.network.send).toBe('function');
    });

    it('network.send forwards to client.engine.events.emit', () => {
      const client = new Client();
      const gameLoader = new GameLoader();
      const integration = new EditorIntegration(client, gameLoader);
      integration.expose();

      const emitSpy = vi.spyOn(client.engine.events, 'emit');
      (globalThis as any).window.modu.network.send('test-event', { foo: 1 });
      expect(emitSpy).toHaveBeenCalledWith('test-event', { foo: 1 });
    });
  });
});
