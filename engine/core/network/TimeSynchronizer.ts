export class TimeSynchronizer {
  private _samples: number[] = [];
  private _offset = 0;
  private _rtt = 0;
  readonly maxSamples: number;

  constructor(maxSamples: number = 5) {
    this.maxSamples = maxSamples;
  }

  get offset(): number { return this._offset; }
  get rtt(): number { return this._rtt; }
  get sampleCount(): number { return this._samples.length; }

  /** Record a ping/pong round-trip. Returns the computed offset. */
  addSample(clientSendTime: number, serverTime: number, clientReceiveTime: number): number {
    this._rtt = clientReceiveTime - clientSendTime;
    const halfRtt = this._rtt / 2;
    const sample = serverTime - (clientSendTime + halfRtt);

    this._samples.push(sample);
    if (this._samples.length > this.maxSamples) {
      this._samples.shift();
    }

    // Use median for stability
    const sorted = [...this._samples].sort((a, b) => a - b);
    this._offset = sorted[Math.floor(sorted.length / 2)];

    return this._offset;
  }

  /** Convert local time to estimated server time */
  toServerTime(localTime: number): number {
    return localTime + this._offset;
  }

  /** Convert server time to estimated local time */
  toLocalTime(serverTime: number): number {
    return serverTime - this._offset;
  }

  reset(): void {
    this._samples = [];
    this._offset = 0;
    this._rtt = 0;
  }
}
