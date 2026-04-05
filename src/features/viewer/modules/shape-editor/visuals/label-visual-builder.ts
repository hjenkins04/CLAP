import {
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Vector3,
} from 'three';
import { RENDER_ORDER_LABEL } from './visual-constants';

export interface LabelOptions {
  text: string;
  fontSize?: number;
  color?: string;
  background?: string;
  padding?: number;
}

/**
 * Build a world-space sprite label. The returned Sprite renders as a
 * billboard (always faces camera). Position it in world space.
 */
export function buildLabel(
  position: Vector3,
  opts: LabelOptions,
): Sprite {
  const {
    text,
    fontSize = 14,
    color = '#ffffff',
    background = 'rgba(0,0,0,0.55)',
    padding = 6,
  } = opts;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `bold ${fontSize}px sans-serif`;
  const textW = ctx.measureText(text).width;
  canvas.width  = Math.ceil(textW + padding * 2);
  canvas.height = Math.ceil(fontSize + padding * 2);

  // Re-get context after resize (some browsers reset state)
  const ctx2 = canvas.getContext('2d')!;
  ctx2.font = `bold ${fontSize}px sans-serif`;
  ctx2.fillStyle = background;
  ctx2.beginPath();
  ctx2.roundRect(0, 0, canvas.width, canvas.height, 3);
  ctx2.fill();
  ctx2.fillStyle = color;
  ctx2.fillText(text, padding, fontSize + padding * 0.6);

  const tex = new CanvasTexture(canvas);
  const mat = new SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new Sprite(mat);
  sprite.renderOrder = RENDER_ORDER_LABEL;

  // Scale sprite to reasonable world-space size
  const aspect = canvas.width / canvas.height;
  const height = 0.5; // world units
  sprite.scale.set(aspect * height, height, 1);
  sprite.position.copy(position);

  return sprite;
}
