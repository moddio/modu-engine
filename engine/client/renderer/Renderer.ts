import * as THREE from 'three';
import { EventEmitter } from '../../core/events/EventEmitter';

export interface RendererOptions {
  width?: number;
  height?: number;
  antialias?: boolean;
  canvas?: HTMLCanvasElement;
}

export class Renderer {
  readonly events = new EventEmitter();
  readonly scene: THREE.Scene;
  readonly threeRenderer: THREE.WebGLRenderer;
  width: number;
  height: number;

  constructor(options: RendererOptions = {}) {
    this.width = options.width ?? 800;
    this.height = options.height ?? 600;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x222222);

    this.threeRenderer = new THREE.WebGLRenderer({
      antialias: options.antialias ?? true,
      canvas: options.canvas,
    });
    this.threeRenderer.setSize(this.width, this.height);
    this.threeRenderer.setPixelRatio(typeof window !== 'undefined' ? window.devicePixelRatio : 1);
  }

  get canvas(): HTMLCanvasElement {
    return this.threeRenderer.domElement;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.threeRenderer.setSize(width, height);
    this.events.emit('resize', [width, height]);
  }

  render(camera: THREE.Camera, _dt: number): void {
    this.threeRenderer.render(this.scene, camera);
  }

  destroy(): void {
    this.threeRenderer.dispose();
    this.events.emit('destroy');
  }
}
