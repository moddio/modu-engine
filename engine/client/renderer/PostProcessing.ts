import { EventEmitter } from '../../core/events/EventEmitter';

export interface PostProcessingConfig {
  bloom?: { enabled: boolean; strength?: number; radius?: number; threshold?: number };
  outline?: { enabled: boolean; color?: number; thickness?: number };
}

export class PostProcessing {
  readonly events = new EventEmitter();
  private _config: PostProcessingConfig;

  // Effect state
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;

  outlineEnabled: boolean;
  outlineColor: number;
  outlineThickness: number;

  constructor(config: PostProcessingConfig = {}) {
    this._config = config;
    this.bloomEnabled = config.bloom?.enabled ?? false;
    this.bloomStrength = config.bloom?.strength ?? 0.5;
    this.bloomRadius = config.bloom?.radius ?? 0.4;
    this.bloomThreshold = config.bloom?.threshold ?? 0.85;

    this.outlineEnabled = config.outline?.enabled ?? false;
    this.outlineColor = config.outline?.color ?? 0xffffff;
    this.outlineThickness = config.outline?.thickness ?? 2;
  }

  setBloom(enabled: boolean, strength?: number, radius?: number, threshold?: number): void {
    this.bloomEnabled = enabled;
    if (strength !== undefined) this.bloomStrength = strength;
    if (radius !== undefined) this.bloomRadius = radius;
    if (threshold !== undefined) this.bloomThreshold = threshold;
    this.events.emit('bloomChanged', {
      enabled,
      strength: this.bloomStrength,
      radius: this.bloomRadius,
      threshold: this.bloomThreshold,
    });
  }

  setOutline(enabled: boolean, color?: number, thickness?: number): void {
    this.outlineEnabled = enabled;
    if (color !== undefined) this.outlineColor = color;
    if (thickness !== undefined) this.outlineThickness = thickness;
    this.events.emit('outlineChanged', {
      enabled,
      color: this.outlineColor,
      thickness: this.outlineThickness,
    });
  }

  /** Will integrate with Three.js EffectComposer in rendering phase */
  update(_dt: number): void {}

  destroy(): void {
    this.bloomEnabled = false;
    this.outlineEnabled = false;
  }
}
