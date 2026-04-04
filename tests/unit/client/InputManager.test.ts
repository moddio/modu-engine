import { describe, it, expect, vi } from 'vitest';
import { InputManager, Key } from '../../../engine/client/input/InputManager';

describe('InputManager', () => {
  it('tracks key down state', () => {
    const input = new InputManager();
    expect(input.isKeyDown(Key.W)).toBe(false);
    input.handleKeyDown(Key.W);
    expect(input.isKeyDown(Key.W)).toBe(true);
    input.handleKeyUp(Key.W);
    expect(input.isKeyDown(Key.W)).toBe(false);
  });

  it('tracks key pressed (single frame)', () => {
    const input = new InputManager();
    input.handleKeyDown(Key.Space);
    expect(input.isKeyPressed(Key.Space)).toBe(true);
    input.endFrame();
    expect(input.isKeyPressed(Key.Space)).toBe(false);
    // Key is still down, but not "just pressed"
    expect(input.isKeyDown(Key.Space)).toBe(true);
  });

  it('does not re-trigger pressed on held key', () => {
    const input = new InputManager();
    input.handleKeyDown(Key.W);
    input.endFrame();
    input.handleKeyDown(Key.W); // Still holding
    expect(input.isKeyPressed(Key.W)).toBe(false);
  });

  it('getKeysDown returns all pressed keys', () => {
    const input = new InputManager();
    input.handleKeyDown(Key.W);
    input.handleKeyDown(Key.D);
    const keys = input.getKeysDown();
    expect(keys).toContain(Key.W);
    expect(keys).toContain(Key.D);
    expect(keys.length).toBe(2);
  });

  it('tracks mouse position', () => {
    const input = new InputManager();
    input.handleMouseMove(100, 200);
    expect(input.mouseX).toBe(100);
    expect(input.mouseY).toBe(200);
  });

  it('tracks mouse down', () => {
    const input = new InputManager();
    expect(input.mouseDown).toBe(false);
    input.handleMouseDown();
    expect(input.mouseDown).toBe(true);
    input.handleMouseUp();
    expect(input.mouseDown).toBe(false);
  });

  it('emits events', () => {
    const input = new InputManager();
    const keydownFn = vi.fn();
    const keyupFn = vi.fn();
    const mouseFn = vi.fn();
    input.events.on('keydown', keydownFn);
    input.events.on('keyup', keyupFn);
    input.events.on('mousedown', mouseFn);

    input.handleKeyDown(Key.W);
    expect(keydownFn).toHaveBeenCalledWith(Key.W);
    input.handleKeyUp(Key.W);
    expect(keyupFn).toHaveBeenCalledWith(Key.W);
    input.handleMouseDown();
    expect(mouseFn).toHaveBeenCalled();
  });

  it('setAngle', () => {
    const input = new InputManager();
    input.setAngle(1.57);
    expect(input.angle).toBeCloseTo(1.57);
  });
});
