import { describe, it, expect, vi } from 'vitest';
import { PostProcessing } from '../../../engine/client/renderer/PostProcessing';

describe('PostProcessing', () => {
  it('default config', () => {
    const pp = new PostProcessing();
    expect(pp.bloomEnabled).toBe(false);
    expect(pp.bloomStrength).toBe(0.5);
    expect(pp.bloomRadius).toBe(0.4);
    expect(pp.bloomThreshold).toBe(0.85);
    expect(pp.outlineEnabled).toBe(false);
    expect(pp.outlineColor).toBe(0xffffff);
    expect(pp.outlineThickness).toBe(2);
  });

  it('constructor applies config', () => {
    const pp = new PostProcessing({
      bloom: { enabled: true, strength: 1.0, radius: 0.8, threshold: 0.5 },
      outline: { enabled: true, color: 0xff0000, thickness: 4 },
    });
    expect(pp.bloomEnabled).toBe(true);
    expect(pp.bloomStrength).toBe(1.0);
    expect(pp.bloomRadius).toBe(0.8);
    expect(pp.bloomThreshold).toBe(0.5);
    expect(pp.outlineEnabled).toBe(true);
    expect(pp.outlineColor).toBe(0xff0000);
    expect(pp.outlineThickness).toBe(4);
  });

  it('setBloom enables and configures bloom', () => {
    const pp = new PostProcessing();
    pp.setBloom(true, 0.8, 0.6, 0.9);
    expect(pp.bloomEnabled).toBe(true);
    expect(pp.bloomStrength).toBe(0.8);
    expect(pp.bloomRadius).toBe(0.6);
    expect(pp.bloomThreshold).toBe(0.9);
  });

  it('setBloom partial update keeps existing values', () => {
    const pp = new PostProcessing();
    pp.setBloom(true, 0.7);
    expect(pp.bloomStrength).toBe(0.7);
    expect(pp.bloomRadius).toBe(0.4); // unchanged default
  });

  it('setOutline enables and configures outline', () => {
    const pp = new PostProcessing();
    pp.setOutline(true, 0x00ff00, 3);
    expect(pp.outlineEnabled).toBe(true);
    expect(pp.outlineColor).toBe(0x00ff00);
    expect(pp.outlineThickness).toBe(3);
  });

  it('emits bloomChanged event', () => {
    const pp = new PostProcessing();
    const cb = vi.fn();
    pp.events.on('bloomChanged', cb);
    pp.setBloom(true, 1.0);
    expect(cb).toHaveBeenCalledWith({
      enabled: true,
      strength: 1.0,
      radius: 0.4,
      threshold: 0.85,
    });
  });

  it('emits outlineChanged event', () => {
    const pp = new PostProcessing();
    const cb = vi.fn();
    pp.events.on('outlineChanged', cb);
    pp.setOutline(true, 0x0000ff, 5);
    expect(cb).toHaveBeenCalledWith({
      enabled: true,
      color: 0x0000ff,
      thickness: 5,
    });
  });

  it('destroy disables all effects', () => {
    const pp = new PostProcessing({
      bloom: { enabled: true },
      outline: { enabled: true },
    });
    pp.destroy();
    expect(pp.bloomEnabled).toBe(false);
    expect(pp.outlineEnabled).toBe(false);
  });
});
