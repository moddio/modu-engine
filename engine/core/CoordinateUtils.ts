export class CoordinateUtils {
  static readonly SCALE_RATIO = 64;

  static pixelToWorld(pixels: number): number {
    return pixels / CoordinateUtils.SCALE_RATIO;
  }

  static worldToPixel(world: number): number {
    return world * CoordinateUtils.SCALE_RATIO;
  }

  static taroToThree(taroX: number, taroY: number, layer: number = 0): { x: number; y: number; z: number } {
    return {
      x: CoordinateUtils.pixelToWorld(taroX),
      y: CoordinateUtils.getLayerZOffset(layer),
      z: CoordinateUtils.pixelToWorld(taroY),
    };
  }

  static threeToTaro(threeX: number, _threeY: number, threeZ: number): { x: number; y: number } {
    return {
      x: CoordinateUtils.worldToPixel(threeX),
      y: CoordinateUtils.worldToPixel(threeZ),
    };
  }

  static getLayerZOffset(layer: number): number {
    return layer - 1;
  }

  static getDepthZOffset(depth: number): number {
    return depth * 0.001;
  }
}
