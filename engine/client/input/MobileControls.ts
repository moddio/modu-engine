import { EventEmitter } from '../../core/events/EventEmitter';

export class MobileControls {
  readonly events = new EventEmitter();
  moveX = 0;  // -1 to 1
  moveY = 0;  // -1 to 1
  active = false;

  handleJoystickMove(x: number, y: number): void {
    this.moveX = Math.max(-1, Math.min(1, x));
    this.moveY = Math.max(-1, Math.min(1, y));
    this.active = true;
    this.events.emit('joystick', [this.moveX, this.moveY]);
  }

  handleJoystickEnd(): void {
    this.moveX = 0;
    this.moveY = 0;
    this.active = false;
    this.events.emit('joystick', [0, 0]);
  }
}
