export interface InputFrame {
  tick: number;
  keys: number[];
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
  angle: number;
}

export class InputBuffer {
  private _buffer: InputFrame[] = [];
  private _maxSize: number;

  constructor(maxSize: number = 120) {
    this._maxSize = maxSize;
  }

  record(frame: InputFrame): void {
    this._buffer.push(frame);
    if (this._buffer.length > this._maxSize) {
      this._buffer.shift();
    }
  }

  getFrame(tick: number): InputFrame | undefined {
    return this._buffer.find(f => f.tick === tick);
  }

  getUnconfirmed(lastServerTick: number): InputFrame[] {
    return this._buffer.filter(f => f.tick > lastServerTick);
  }

  confirm(tick: number): void {
    this._buffer = this._buffer.filter(f => f.tick > tick);
  }

  get size(): number { return this._buffer.length; }

  clear(): void { this._buffer = []; }
}
