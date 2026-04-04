import { EventEmitter } from '../engine/core/events/EventEmitter';

export interface EditEntityData {
  id: string;
  props: Record<string, unknown>;
}

export interface RegionData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
}

export interface ScriptChangesData {
  scripts: Array<{ name: string; code: string }>;
}

export interface EditorBridge {
  updateEntity(data: EditEntityData): void;
  updateRegion(data: RegionData): void;
  editGlobalScripts(data: ScriptChangesData): void;
  saveMap(): void;
}

export class EditorBridgeImpl {
  readonly events = new EventEmitter();
  private _externalEditor: EditorBridge | null = null;

  connectExternal(editor: EditorBridge): void {
    this._externalEditor = editor;
  }

  disconnectExternal(): void {
    this._externalEditor = null;
  }

  get isConnected(): boolean {
    return this._externalEditor !== null;
  }

  notifyEntityUpdate(data: EditEntityData): void {
    this._externalEditor?.updateEntity(data);
    this.events.emit('entityUpdate', data);
  }

  notifyRegionUpdate(data: RegionData): void {
    this._externalEditor?.updateRegion(data);
    this.events.emit('regionUpdate', data);
  }

  notifyScriptChanges(data: ScriptChangesData): void {
    this._externalEditor?.editGlobalScripts(data);
    this.events.emit('scriptChanges', data);
  }

  saveMap(): void {
    this._externalEditor?.saveMap();
    this.events.emit('saveMap');
  }
}
