export enum MessageType {
  // Client -> Server
  Input = 1,
  ChatMessage = 2,
  JoinGame = 3,
  LeaveGame = 4,

  // Server -> Client
  Snapshot = 10,
  DeltaUpdate = 11,
  EntityCreate = 12,
  EntityDestroy = 13,
  ServerChatMessage = 14,
  PlayerJoined = 15,
  PlayerLeft = 16,

  // Bidirectional
  Ping = 20,
  Pong = 21,
}

export interface NetworkMessage {
  type: MessageType;
  tick: number;
  data: unknown;
}

export interface InputMessage {
  type: MessageType.Input;
  tick: number;
  data: {
    keys: number[];  // key codes currently pressed
    mouseX: number;
    mouseY: number;
    mouseDown: boolean;
    angle: number;   // aim angle
  };
}

export interface SnapshotMessage {
  type: MessageType.Snapshot;
  tick: number;
  data: {
    entities: Record<string, EntitySnapshot>;
  };
}

export interface EntitySnapshot {
  id: string;
  category: string;
  x: number;
  y: number;
  z: number;
  angle: number;
  stats?: Record<string, unknown>;
}
