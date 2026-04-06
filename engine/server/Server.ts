import { GameServer } from './GameServer';
import { WebSocketServerTransport } from './transport/WebSocketServerTransport';
import type { GameData } from '../core/GameLoader';

/**
 * Production game server that listens for WebSocket connections.
 * Uses the same GameServer class as the local Web Worker server —
 * only the transport layer differs.
 *
 * Usage:
 *   const server = new Server();
 *   await server.start(8080, gameData);
 *   // Players connect via WebSocket
 *   server.stop();
 */
export class Server {
  private _gameServer: GameServer | null = null;
  private _wss: any = null;

  /** Start the game server on the given port */
  async start(port: number = 8080, gameData: GameData, rawGameData?: Record<string, any>): Promise<void> {
    // Create WebSocket server
    const { WebSocketServer } = await import('ws');
    this._wss = new WebSocketServer({ port });

    // Create transport + game server
    const transport = new WebSocketServerTransport(this._wss);
    this._gameServer = new GameServer(transport);

    // Initialize and start
    await this._gameServer.init(gameData, rawGameData);
    this._gameServer.start();

    console.log(`[Server] Game server running on port ${port}`);
  }

  /** Stop the server */
  stop(): void {
    this._gameServer?.stop();
    this._wss?.close();
    this._gameServer = null;
    this._wss = null;
  }

  get gameServer(): GameServer | null { return this._gameServer; }
  get isRunning(): boolean { return this._gameServer?.isRunning ?? false; }
}
