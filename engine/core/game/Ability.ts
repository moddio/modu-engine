import { Component } from '../ecs/Component';

export interface AbilityDef {
  name: string;
  cooldown: number; // ms
  duration: number; // ms, 0 = instant
  [key: string]: unknown;
}

interface AbilityState {
  def: AbilityDef;
  cooldownRemaining: number;
  active: boolean;
  activeRemaining: number;
}

export class AbilityManager extends Component {
  static readonly id = 'ability';
  private _abilities = new Map<string, AbilityState>();

  register(def: AbilityDef): void {
    this._abilities.set(def.name, {
      def,
      cooldownRemaining: 0,
      active: false,
      activeRemaining: 0,
    });
  }

  activate(name: string): boolean {
    const ability = this._abilities.get(name);
    if (!ability) return false;
    if (ability.cooldownRemaining > 0) return false;
    if (ability.active) return false;

    if (ability.def.duration > 0) {
      ability.active = true;
      ability.activeRemaining = ability.def.duration;
    }
    ability.cooldownRemaining = ability.def.cooldown;
    return true;
  }

  isOnCooldown(name: string): boolean {
    return (this._abilities.get(name)?.cooldownRemaining ?? 0) > 0;
  }

  isActive(name: string): boolean {
    return this._abilities.get(name)?.active ?? false;
  }

  update(dt: number): void {
    for (const state of this._abilities.values()) {
      if (state.cooldownRemaining > 0) {
        state.cooldownRemaining = Math.max(0, state.cooldownRemaining - dt);
      }
      if (state.active) {
        state.activeRemaining -= dt;
        if (state.activeRemaining <= 0) {
          state.active = false;
          state.activeRemaining = 0;
        }
      }
    }
  }
}
