import { EventEmitter } from '../../core/events/EventEmitter';

export interface UIComponent {
  readonly name: string;
  visible: boolean;
  show(): void;
  hide(): void;
  destroy(): void;
}

export class UIManager {
  readonly events = new EventEmitter();
  private _components = new Map<string, UIComponent>();

  register(component: UIComponent): void {
    this._components.set(component.name, component);
  }

  unregister(name: string): void {
    const comp = this._components.get(name);
    if (comp) {
      comp.destroy();
      this._components.delete(name);
    }
  }

  get(name: string): UIComponent | undefined {
    return this._components.get(name);
  }

  show(name: string): void {
    const comp = this._components.get(name);
    if (comp) {
      comp.show();
      this.events.emit('show', name);
    }
  }

  hide(name: string): void {
    const comp = this._components.get(name);
    if (comp) {
      comp.hide();
      this.events.emit('hide', name);
    }
  }

  hideAll(): void {
    for (const comp of this._components.values()) comp.hide();
  }

  get componentCount(): number { return this._components.size; }

  destroy(): void {
    for (const comp of this._components.values()) comp.destroy();
    this._components.clear();
  }
}
