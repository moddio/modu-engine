import { EventEmitter } from '../../core/events/EventEmitter';

export interface RendererOptions {
  width?: number;
  height?: number;
  antialias?: boolean;
}

export class Renderer {
  readonly events = new EventEmitter();
  width: number;
  height: number;

  constructor(options: RendererOptions = {}) {
    this.width = options.width ?? 800;
    this.height = options.height ?? 600;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.events.emit('resize', [width, height]);
  }

  render(_dt: number): void {
    // Will be implemented with Three.js
  }

  destroy(): void {
    this.events.emit('destroy');
  }
}
