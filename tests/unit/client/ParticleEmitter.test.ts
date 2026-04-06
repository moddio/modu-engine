import { describe, it, expect, vi } from 'vitest';
import { ParticleEmitter } from '../../../engine/client/renderer/ParticleEmitter';

describe('ParticleEmitter', () => {
  it('defaults', () => {
    const pe = new ParticleEmitter();
    expect(pe.active).toBe(false);
    expect(pe.particleCount).toBe(0);
    expect(pe.config.maxParticles).toBe(100);
    expect(pe.config.emitRate).toBe(10);
  });

  it('custom config merges with defaults', () => {
    const pe = new ParticleEmitter({ maxParticles: 50, speed: 100 });
    expect(pe.config.maxParticles).toBe(50);
    expect(pe.config.speed).toBe(100);
    expect(pe.config.emitRate).toBe(10); // default
  });

  it('start/stop toggle active', () => {
    const pe = new ParticleEmitter();
    pe.start();
    expect(pe.active).toBe(true);
    pe.stop();
    expect(pe.active).toBe(false);
  });

  it('emits started/stopped events', () => {
    const pe = new ParticleEmitter();
    const startCb = vi.fn();
    const stopCb = vi.fn();
    pe.events.on('started', startCb);
    pe.events.on('stopped', stopCb);
    pe.start();
    expect(startCb).toHaveBeenCalledTimes(1);
    pe.stop();
    expect(stopCb).toHaveBeenCalledTimes(1);
  });

  it('update accumulates particles based on emit rate', () => {
    // emitRate=10 means 1 particle every 100ms
    const pe = new ParticleEmitter({ emitRate: 10 });
    pe.start();
    pe.update(250); // should emit 2 particles (at 100ms and 200ms)
    expect(pe.particleCount).toBe(2);
    pe.update(100); // should emit 1 more (accumulator was 50 + 100 = 150, emit at 100)
    expect(pe.particleCount).toBe(3);
  });

  it('respects maxParticles cap', () => {
    const pe = new ParticleEmitter({ maxParticles: 5, emitRate: 100 });
    pe.start();
    pe.update(10000); // way more than enough time
    expect(pe.particleCount).toBe(5);
  });

  it('update does nothing when inactive', () => {
    const pe = new ParticleEmitter({ emitRate: 100 });
    pe.update(1000);
    expect(pe.particleCount).toBe(0);
  });

  it('reset clears state', () => {
    const pe = new ParticleEmitter({ emitRate: 10 });
    pe.start();
    pe.update(500);
    expect(pe.particleCount).toBeGreaterThan(0);
    pe.reset();
    expect(pe.active).toBe(false);
    expect(pe.particleCount).toBe(0);
  });

  it('dispose stops emitter', () => {
    const pe = new ParticleEmitter();
    pe.start();
    pe.dispose();
    expect(pe.active).toBe(false);
  });
});
