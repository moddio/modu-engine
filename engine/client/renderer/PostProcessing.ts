// Post-processing will be added when EffectComposer is integrated
// For now, this is a placeholder that does nothing

export class PostProcessing {
  enabled = false;
  bloomEnabled = false;
  outlineEnabled = false;

  // Will integrate Three.js EffectComposer, UnrealBloomPass, OutlinePass
  update(_dt: number): void {}
  destroy(): void {}
}
