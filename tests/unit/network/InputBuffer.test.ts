import { describe, it, expect } from 'vitest';
import { InputBuffer } from '../../../engine/core/network/InputBuffer';

const makeFrame = (tick: number) => ({
  tick, keys: [], mouseX: 0, mouseY: 0, mouseDown: false, angle: 0,
});

describe('InputBuffer', () => {
  it('records frames', () => {
    const buf = new InputBuffer();
    buf.record(makeFrame(1));
    buf.record(makeFrame(2));
    expect(buf.size).toBe(2);
  });

  it('getFrame by tick', () => {
    const buf = new InputBuffer();
    buf.record(makeFrame(5));
    buf.record(makeFrame(6));
    expect(buf.getFrame(5)?.tick).toBe(5);
    expect(buf.getFrame(7)).toBeUndefined();
  });

  it('getUnconfirmed returns frames after server tick', () => {
    const buf = new InputBuffer();
    buf.record(makeFrame(1));
    buf.record(makeFrame(2));
    buf.record(makeFrame(3));
    const unconfirmed = buf.getUnconfirmed(1);
    expect(unconfirmed.length).toBe(2);
    expect(unconfirmed[0].tick).toBe(2);
  });

  it('confirm removes old frames', () => {
    const buf = new InputBuffer();
    buf.record(makeFrame(1));
    buf.record(makeFrame(2));
    buf.record(makeFrame(3));
    buf.confirm(2);
    expect(buf.size).toBe(1);
    expect(buf.getFrame(3)?.tick).toBe(3);
  });

  it('respects max size', () => {
    const buf = new InputBuffer(3);
    buf.record(makeFrame(1));
    buf.record(makeFrame(2));
    buf.record(makeFrame(3));
    buf.record(makeFrame(4));
    expect(buf.size).toBe(3);
    expect(buf.getFrame(1)).toBeUndefined();
  });

  it('clear empties buffer', () => {
    const buf = new InputBuffer();
    buf.record(makeFrame(1));
    buf.clear();
    expect(buf.size).toBe(0);
  });
});
