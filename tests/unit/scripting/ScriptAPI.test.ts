import { describe, it, expect, vi } from 'vitest';
import { ScriptAPI } from '../../../engine/core/scripting/ScriptAPI';
import { EventEmitter } from '../../../engine/core/events/EventEmitter';

describe('ScriptAPI', () => {
  it('on registers event listener', () => {
    const events = new EventEmitter();
    const api = new ScriptAPI(events);
    const fn = vi.fn();
    api.on('test', fn);
    events.emit('test', 42);
    expect(fn).toHaveBeenCalledWith(42);
  });

  it('every fires at interval', () => {
    const events = new EventEmitter();
    const api = new ScriptAPI(events);
    const fn = vi.fn();
    api.every(100, fn);
    api.update(50);
    expect(fn).not.toHaveBeenCalled();
    api.update(60);
    expect(fn).toHaveBeenCalledOnce();
    api.update(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('reset clears intervals', () => {
    const events = new EventEmitter();
    const api = new ScriptAPI(events);
    const fn = vi.fn();
    api.every(100, fn);
    api.reset();
    api.update(200);
    expect(fn).not.toHaveBeenCalled();
  });
});
