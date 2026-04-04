import { Engine } from '../core/Engine';
import { ServerSocket } from './network/ServerSocket';
import { ServerNetworkHandler } from './network/ServerNetworkHandler';

export class Server {
  readonly engine: Engine;
  readonly socket: ServerSocket;
  readonly network: ServerNetworkHandler;
  private _tickInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.engine = Engine.instance();
    this.socket = new ServerSocket();
    this.network = new ServerNetworkHandler(this.socket);
  }

  start(port: number = 8080): void {
    this.socket.start(port);
    const tickRate = this.engine.clock.tickRate;
    const interval = 1000 / tickRate;
    let lastTime = Date.now();

    this._tickInterval = setInterval(() => {
      const now = Date.now();
      const dt = now - lastTime;
      lastTime = now;
      this.engine.step(dt);
      this.network.bandwidthBudget.resetAll();
    }, interval);
  }

  stop(): void {
    if (this._tickInterval) clearInterval(this._tickInterval);
    this.socket.stop();
    Engine.reset();
  }
}
