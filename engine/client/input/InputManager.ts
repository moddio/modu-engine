import { EventEmitter } from '../../core/events/EventEmitter';

export enum Key {
  W = 87, A = 65, S = 83, D = 68,
  Up = 38, Down = 40, Left = 37, Right = 39,
  Space = 32, Shift = 16, Ctrl = 17,
  E = 69, F = 70, R = 82, Q = 81,
  Num1 = 49, Num2 = 50, Num3 = 51, Num4 = 52,
  Escape = 27, Enter = 13, Tab = 9,
}

export class InputManager {
  readonly events = new EventEmitter();
  private _keysDown = new Set<number>();
  private _keysPressed = new Set<number>(); // pressed this frame
  private _mouseX = 0;
  private _mouseY = 0;
  private _mouseDown = false;
  private _angle = 0;

  get mouseX(): number { return this._mouseX; }
  get mouseY(): number { return this._mouseY; }
  get mouseDown(): boolean { return this._mouseDown; }
  get angle(): number { return this._angle; }

  isKeyDown(keyCode: number): boolean {
    return this._keysDown.has(keyCode);
  }

  isKeyPressed(keyCode: number): boolean {
    return this._keysPressed.has(keyCode);
  }

  getKeysDown(): number[] {
    return [...this._keysDown];
  }

  // Called by platform code (browser event handlers)
  handleKeyDown(keyCode: number): void {
    if (!this._keysDown.has(keyCode)) {
      this._keysPressed.add(keyCode);
    }
    this._keysDown.add(keyCode);
    this.events.emit('keydown', keyCode);
  }

  handleKeyUp(keyCode: number): void {
    this._keysDown.delete(keyCode);
    this.events.emit('keyup', keyCode);
  }

  handleMouseMove(x: number, y: number): void {
    this._mouseX = x;
    this._mouseY = y;
    this.events.emit('mousemove', [x, y]);
  }

  handleMouseDown(): void {
    this._mouseDown = true;
    this.events.emit('mousedown');
  }

  handleMouseUp(): void {
    this._mouseDown = false;
    this.events.emit('mouseup');
  }

  setAngle(angle: number): void {
    this._angle = angle;
  }

  // Call at end of each frame to clear per-frame state
  endFrame(): void {
    this._keysPressed.clear();
  }
}
