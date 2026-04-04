import { Label } from './Label';

export class ChatBubble extends Label {
  private _duration: number;
  private _elapsed = 0;

  constructor(text: string, duration: number = 3000) {
    super(text, { color: '#ffffff', fontSize: 12 });
    this._duration = duration;
  }

  get isExpired(): boolean { return this._elapsed >= this._duration; }

  update(dt: number): void {
    this._elapsed += dt;
  }
}
