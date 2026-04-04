export class BandwidthBudget {
  private _budgets = new Map<string, number>();
  private _maxBytesPerTick: number;

  constructor(maxBytesPerTick: number = 16384) { // 16KB default
    this._maxBytesPerTick = maxBytesPerTick;
  }

  get maxBytesPerTick(): number { return this._maxBytesPerTick; }

  canSend(playerId: string, bytes: number): boolean {
    const used = this._budgets.get(playerId) ?? 0;
    return used + bytes <= this._maxBytesPerTick;
  }

  record(playerId: string, bytes: number): void {
    const used = this._budgets.get(playerId) ?? 0;
    this._budgets.set(playerId, used + bytes);
  }

  getUsed(playerId: string): number {
    return this._budgets.get(playerId) ?? 0;
  }

  resetAll(): void {
    this._budgets.clear();
  }

  resetPlayer(playerId: string): void {
    this._budgets.delete(playerId);
  }
}
