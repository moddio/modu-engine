// UI components will be implemented with DOM/HTML
// For now, export type interfaces

export interface UIComponent {
  show(): void;
  hide(): void;
  destroy(): void;
}

export interface MenuUIOptions {
  title?: string;
}

export interface ShopUIOptions {
  items?: Array<{ name: string; cost: number }>;
}
