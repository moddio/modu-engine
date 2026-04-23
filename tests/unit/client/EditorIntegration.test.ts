import { describe, it, expect, beforeEach, vi } from 'vitest';
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
});
