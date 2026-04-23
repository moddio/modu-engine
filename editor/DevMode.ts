import { EventEmitter } from '../engine/core/events/EventEmitter';
import { EditorBridgeImpl } from './EditorBridge';

export type EditorTool = 'cursor' | 'brush' | 'fill' | 'eraser' | 'entity' | 'region';

export class DevMode {
  readonly events = new EventEmitter();
  readonly bridge = new EditorBridgeImpl();
  activeTool: EditorTool = 'cursor';
  active = false;
  activeTab: string | null = null;

  enter(): void {
    this.active = true;
    this.events.emit('enter');
  }

  leave(): void {
    this.active = false;
    this.activeTool = 'cursor';
    this.events.emit('leave');
  }

  setTool(tool: EditorTool): void {
    this.activeTool = tool;
    this.events.emit('toolChange', tool);
  }

  changeTab(tab: string): void {
    if (tab === this.activeTab) return;
    const from = this.activeTab;
    this.activeTab = tab;
    this.events.emit('tabChange', { from, to: tab });
  }
}
