import * as THREE from 'three';
import { EventEmitter } from '../../core/events/EventEmitter';

export interface ParticleConfig {
  maxParticles: number;
  emitRate: number;       // particles per second
  lifetime: number;       // ms
  speed: number;
  spread: number;         // angle in radians
  color: number;
  size: number;
  gravity: number;
}

const DEFAULT_CONFIG: ParticleConfig = {
  maxParticles: 100,
  emitRate: 10,
  lifetime: 1000,
  speed: 50,
  spread: Math.PI / 4,
  color: 0xffffff,
  size: 2,
  gravity: 0,
};

export class ParticleEmitter {
  readonly group = new THREE.Group();
  readonly events = new EventEmitter();
  readonly config: ParticleConfig;
  private _active = false;
  private _elapsed = 0;
  private _emitAccumulator = 0;
  private _particleCount = 0;

  constructor(config?: Partial<ParticleConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get active(): boolean { return this._active; }
  get particleCount(): number { return this._particleCount; }

  start(): void {
    this._active = true;
    this._elapsed = 0;
    this._emitAccumulator = 0;
    this.events.emit('started');
  }

  stop(): void {
    this._active = false;
    this.events.emit('stopped');
  }

  update(dt: number): void {
    if (!this._active) return;
    this._elapsed += dt;

    // Emit new particles based on rate
    this._emitAccumulator += dt;
    const emitInterval = 1000 / this.config.emitRate;
    while (this._emitAccumulator >= emitInterval && this._particleCount < this.config.maxParticles) {
      this._emitAccumulator -= emitInterval;
      this._particleCount++;
      // Actual particle creation will use Three.js Points/sprites
    }
  }

  reset(): void {
    this._active = false;
    this._elapsed = 0;
    this._emitAccumulator = 0;
    this._particleCount = 0;
  }

  dispose(): void {
    this.stop();
    this.group.removeFromParent();
  }
}
