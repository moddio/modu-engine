import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../../engine/core/events/EventEmitter';

describe('EventEmitter', () => {
  describe('on and emit', () => {
    it('calls listener when event is emitted', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      emitter.on('test', fn);
      emitter.emit('test');
      expect(fn).toHaveBeenCalledOnce();
    });
    it('passes data to listener', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      emitter.on('test', fn);
      emitter.emit('test', { foo: 'bar' });
      expect(fn).toHaveBeenCalledWith({ foo: 'bar' });
    });
    it('supports multiple listeners', () => {
      const emitter = new EventEmitter();
      const fn1 = vi.fn(), fn2 = vi.fn();
      emitter.on('test', fn1);
      emitter.on('test', fn2);
      emitter.emit('test');
      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).toHaveBeenCalledOnce();
    });
    it('does not call listener for different event', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      emitter.on('test', fn);
      emitter.emit('other');
      expect(fn).not.toHaveBeenCalled();
    });
    it('passes multiple arguments via array', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      emitter.on('test', fn);
      emitter.emit('test', [1, 2, 3]);
      expect(fn).toHaveBeenCalledWith(1, 2, 3);
    });
  });

  describe('off', () => {
    it('removes a specific listener', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      const handle = emitter.on('test', fn);
      emitter.off('test', handle);
      emitter.emit('test');
      expect(fn).not.toHaveBeenCalled();
    });
    it('does not affect other listeners', () => {
      const emitter = new EventEmitter();
      const fn1 = vi.fn(), fn2 = vi.fn();
      const handle1 = emitter.on('test', fn1);
      emitter.on('test', fn2);
      emitter.off('test', handle1);
      emitter.emit('test');
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalledOnce();
    });
  });

  describe('once', () => {
    it('fires listener only once', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      emitter.once('test', fn);
      emitter.emit('test');
      emitter.emit('test');
      expect(fn).toHaveBeenCalledOnce();
    });
    it('passes data to one-shot listener', () => {
      const emitter = new EventEmitter();
      const fn = vi.fn();
      emitter.once('test', fn);
      emitter.emit('test', 42);
      expect(fn).toHaveBeenCalledWith(42);
    });
  });

  describe('emit during emit (deferred removal)', () => {
    it('safely removes listener during emit', () => {
      const emitter = new EventEmitter();
      const fn1 = vi.fn(), fn2 = vi.fn();
      let handle1: any;
      handle1 = emitter.on('test', () => {
        fn1();
        emitter.off('test', handle1);
      });
      emitter.on('test', fn2);
      emitter.emit('test');
      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).toHaveBeenCalledOnce();
      fn1.mockClear(); fn2.mockClear();
      emitter.emit('test');
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalledOnce();
    });
  });

  describe('removeAllListeners', () => {
    it('removes all for event', () => {
      const emitter = new EventEmitter();
      const fn1 = vi.fn(), fn2 = vi.fn();
      emitter.on('test', fn1); emitter.on('test', fn2);
      emitter.removeAllListeners('test');
      emitter.emit('test');
      expect(fn1).not.toHaveBeenCalled(); expect(fn2).not.toHaveBeenCalled();
    });
    it('removes all when no event', () => {
      const emitter = new EventEmitter();
      const fn1 = vi.fn(), fn2 = vi.fn();
      emitter.on('a', fn1); emitter.on('b', fn2);
      emitter.removeAllListeners();
      emitter.emit('a'); emitter.emit('b');
      expect(fn1).not.toHaveBeenCalled(); expect(fn2).not.toHaveBeenCalled();
    });
  });

  describe('listenerCount', () => {
    it('returns count', () => {
      const emitter = new EventEmitter();
      emitter.on('test', () => {}); emitter.on('test', () => {}); emitter.on('other', () => {});
      expect(emitter.listenerCount('test')).toBe(2);
      expect(emitter.listenerCount('other')).toBe(1);
      expect(emitter.listenerCount('none')).toBe(0);
    });
  });
});
