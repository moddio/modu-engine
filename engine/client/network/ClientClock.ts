// engine/client/network/ClientClock.ts
export class ClientClock {
  serverTick = 0;
  clientTick = 0;
  rtt = 0; // round-trip time in ms
  private _offset = 0;
  private _rttSamples: number[] = [];

  get estimatedServerTick(): number {
    return this.clientTick + this._offset;
  }

  recordPong(clientSendTime: number, serverTick: number): void {
    const now = Date.now();
    const rtt = now - clientSendTime;
    this._rttSamples.push(rtt);
    if (this._rttSamples.length > 10) this._rttSamples.shift();
    this.rtt = this._rttSamples.reduce((a, b) => a + b, 0) / this._rttSamples.length;
    this.serverTick = serverTick;
  }

  step(): void {
    this.clientTick++;
  }

  get interpolationTick(): number {
    // Render slightly behind to allow for interpolation buffer
    return this.clientTick - 2;
  }
}
