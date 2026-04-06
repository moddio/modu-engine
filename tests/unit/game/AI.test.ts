import { describe, it, expect } from 'vitest';
import { AIComponent } from '../../../engine/core/game/AI';
import { Vec2 } from '../../../engine/core/math/Vec2';

describe('AIComponent', () => {
  it('has default config', () => {
    const ai = new AIComponent();
    expect(ai.config.sightRange).toBe(200);
    expect(ai.config.attackRange).toBe(30);
    expect(ai.config.maxIdleTime).toBe(3000);
    expect(ai.config.patrolPath).toBeUndefined();
  });

  it('accepts custom config', () => {
    const path = [new Vec2(0, 0), new Vec2(100, 0)];
    const ai = new AIComponent({ sightRange: 500, patrolPath: path });
    expect(ai.config.sightRange).toBe(500);
    expect(ai.config.attackRange).toBe(30);
    expect(ai.config.patrolPath).toBe(path);
  });

  it('starts in idle state', () => {
    const ai = new AIComponent();
    expect(ai.state).toBe('idle');
    expect(ai.stateTime).toBe(0);
  });

  it('setState changes state and resets stateTime', () => {
    const ai = new AIComponent();
    ai.update(100);
    expect(ai.stateTime).toBe(100);
    ai.setState('chase');
    expect(ai.state).toBe('chase');
    expect(ai.stateTime).toBe(0);
  });

  it('setState does not reset time if same state', () => {
    const ai = new AIComponent();
    ai.update(100);
    ai.setState('idle');
    expect(ai.stateTime).toBe(100);
  });

  it('update accumulates stateTime', () => {
    const ai = new AIComponent();
    ai.update(50);
    ai.update(30);
    expect(ai.stateTime).toBe(80);
  });

  it('supports wander state', () => {
    const ai = new AIComponent();
    ai.setState('wander');
    expect(ai.state).toBe('wander');
  });

  it('tracks target entity id', () => {
    const ai = new AIComponent();
    ai.targetEntityId = 'enemy_1';
    expect(ai.targetEntityId).toBe('enemy_1');
  });

  it('tracks target position', () => {
    const ai = new AIComponent();
    ai.target = new Vec2(50, 75);
    expect(ai.target.x).toBe(50);
    expect(ai.target.y).toBe(75);
  });

  it('exposes sightRange and attackRange getters', () => {
    const ai = new AIComponent({ sightRange: 300, attackRange: 50 });
    expect(ai.sightRange).toBe(300);
    expect(ai.attackRange).toBe(50);
  });

  it('has static id', () => {
    expect(AIComponent.id).toBe('ai');
  });
});
