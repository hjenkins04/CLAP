export type ColorMode = 'rgb' | 'height' | 'classification' | 'intensity';
export type CameraProjection = 'perspective' | 'orthographic';

export interface ViewerConfig {
  pointBudget: number;
  pointSize: number;
  colorMode: ColorMode;
  edlEnabled: boolean;
  edlStrength: number;
  edlRadius: number;
  cameraProjection: CameraProjection;
}

export const DEFAULT_VIEWER_CONFIG: ViewerConfig = {
  pointBudget: 5_000_000,
  pointSize: 0.1,
  colorMode: 'rgb',
  edlEnabled: false,
  edlStrength: 0.4,
  edlRadius: 1.4,
  cameraProjection: 'orthographic',
};

export const COLOR_MODE_MAP: Record<ColorMode, number> = {
  rgb: 0,
  height: 3,
  classification: 5,
  intensity: 4,
};
