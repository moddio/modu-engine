export type EventListener = (...args: unknown[]) => void;

export interface EventHandle {
  callback: EventListener;
  once: boolean;
}

export class EventEmitter {
  private _listeners = new Map<string, EventHandle[]>();
  private _emitting = false;
  private _removeQueue: Array<{ event: string; handle: EventHandle }> = [];

  on(event: string, callback: EventListener): EventHandle {
    const handle: EventHandle = { callback, once: false };
    this._getOrCreate(event).push(handle);
    return handle;
  }

  once(event: string, callback: EventListener): EventHandle {
    const handle: EventHandle = { callback, once: true };
    this._getOrCreate(event).push(handle);
    return handle;
  }

  off(event: string, handle: EventHandle): boolean {
    if (this._emitting) {
      this._removeQueue.push({ event, handle });
      return true;
    }
    return this._removeHandle(event, handle);
  }

  emit(event: string, data?: unknown): void {
    const handles = this._listeners.get(event);
    if (!handles || handles.length === 0) return;
    this._emitting = true;
    const len = handles.length;
    for (let i = 0; i < len; i++) {
      const handle = handles[i];
      if (Array.isArray(data)) {
        handle.callback(...data);
      } else if (data !== undefined) {
        handle.callback(data);
      } else {
        handle.callback();
      }
      if (handle.once) {
        this._removeQueue.push({ event, handle });
      }
    }
    this._emitting = false;
    this._processRemoveQueue();
  }

  removeAllListeners(event?: string): void {
    if (event) { this._listeners.delete(event); }
    else { this._listeners.clear(); }
  }

  listenerCount(event: string): number {
    return this._listeners.get(event)?.length ?? 0;
  }

  private _getOrCreate(event: string): EventHandle[] {
    let arr = this._listeners.get(event);
    if (!arr) { arr = []; this._listeners.set(event, arr); }
    return arr;
  }

  private _removeHandle(event: string, handle: EventHandle): boolean {
    const arr = this._listeners.get(event);
    if (!arr) return false;
    const idx = arr.indexOf(handle);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    return true;
  }

  private _processRemoveQueue(): void {
    for (const { event, handle } of this._removeQueue) {
      this._removeHandle(event, handle);
    }
    this._removeQueue.length = 0;
  }
}
