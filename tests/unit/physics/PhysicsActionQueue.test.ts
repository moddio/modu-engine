import { describe, it, expect } from 'vitest';
import { PhysicsActionQueue } from '../../../engine/core/physics/PhysicsActionQueue';
import type { PhysicsAction } from '../../../engine/core/physics/PhysicsActionQueue';

describe('PhysicsActionQueue', () => {
  it('starts empty', () => {
    const queue = new PhysicsActionQueue();
    expect(queue.length).toBe(0);
  });

  it('enqueue adds actions', () => {
    const queue = new PhysicsActionQueue();
    queue.enqueue({ type: 'createBody', entityId: 'e1' });
    queue.enqueue({ type: 'destroyBody', entityId: 'e2' });
    expect(queue.length).toBe(2);
  });

  it('drain returns all actions and clears', () => {
    const queue = new PhysicsActionQueue();
    const a1: PhysicsAction = { type: 'createBody', entityId: 'e1' };
    const a2: PhysicsAction = { type: 'setLinearVelocity', entityId: 'e2', data: { x: 1, y: 0 } };
    queue.enqueue(a1);
    queue.enqueue(a2);

    const drained = queue.drain();
    expect(drained).toHaveLength(2);
    expect(drained[0]).toBe(a1);
    expect(drained[1]).toBe(a2);
    expect(queue.length).toBe(0);
  });

  it('drain returns empty array when empty', () => {
    const queue = new PhysicsActionQueue();
    expect(queue.drain()).toHaveLength(0);
  });

  it('clear removes all queued actions', () => {
    const queue = new PhysicsActionQueue();
    queue.enqueue({ type: 'applyForce', entityId: 'e1' });
    queue.enqueue({ type: 'applyImpulse', entityId: 'e2' });
    queue.clear();
    expect(queue.length).toBe(0);
    expect(queue.drain()).toHaveLength(0);
  });

  it('length tracks count correctly', () => {
    const queue = new PhysicsActionQueue();
    expect(queue.length).toBe(0);
    queue.enqueue({ type: 'createBody', entityId: 'e1' });
    expect(queue.length).toBe(1);
    queue.enqueue({ type: 'createBody', entityId: 'e2' });
    expect(queue.length).toBe(2);
    queue.drain();
    expect(queue.length).toBe(0);
  });
});
