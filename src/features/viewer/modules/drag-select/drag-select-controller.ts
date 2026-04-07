import type { DragSelectMode, DragSelectOptions, SelectionFrustum } from './drag-select-types';
import { buildFrustum, getDragSelectMode } from './drag-select-utils';

const OVERLAY_STYLE: Record<DragSelectMode, { border: string; bg: string }> = {
  replace:  { border: 'rgba(68,136,255,0.9)',  bg: 'rgba(68,136,255,0.12)' },
  add:      { border: 'rgba(0,212,255,0.8)',   bg: 'rgba(0,212,255,0.08)' },
  subtract: { border: 'rgba(255,80,80,0.8)',   bg: 'rgba(255,80,80,0.10)' },
};

/**
 * Shared drag-select controller — rubber-band overlay + NDC frustum generation.
 *
 * Supports two integration patterns:
 *
 * **Auto-register** (for plugins that own their own interaction loop):
 * ```ts
 * const ctrl = new DragSelectController({ domElement, getCamera, onSelect });
 * ctrl.activate();   // registers listeners on domElement + window
 * ctrl.deactivate(); // unregisters
 * ```
 *
 * **Manual** (when the parent already manages pointer events):
 * ```ts
 * // In your own onPointerDown/Move/Up handlers:
 * ctrl.handlePointerDown(e);
 * ctrl.handlePointerMove(e);
 * ctrl.handlePointerUp(e);
 * // Check ctrl.isDragging to know when a drag rect is active.
 * ```
 */
export class DragSelectController {
  private readonly opts: DragSelectOptions;
  private readonly minDragPx: number;

  private dragStart: { x: number; y: number } | null = null;
  private currentMode: DragSelectMode = 'replace';
  private overlayEl: HTMLDivElement | null = null;
  private autoRegistered = false;

  private _isDragging = false;
  /** True while the rubber-band rect is visible (pointer held + moved past threshold). */
  get isDragging(): boolean { return this._isDragging; }

  constructor(opts: DragSelectOptions) {
    this.opts = opts;
    this.minDragPx = opts.minDragPx ?? 5;
  }

  // ── Auto-register API ──────────────────────────────────────────────────────

  activate(): void {
    if (this.autoRegistered) return;
    this.autoRegistered = true;
    this.opts.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  deactivate(): void {
    if (!this.autoRegistered) return;
    this.autoRegistered = false;
    this.opts.domElement.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.cleanup();
  }

  // ── Manual API ─────────────────────────────────────────────────────────────

  /** Call from your own pointerdown handler. */
  handlePointerDown(e: PointerEvent): void { this.onPointerDown(e); }
  /** Call from your own pointermove handler. */
  handlePointerMove(e: PointerEvent): void { this.onPointerMove(e); }
  /** Call from your own pointerup handler. */
  handlePointerUp(e: PointerEvent): void   { this.onPointerUp(e); }

  // ── Core ───────────────────────────────────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.currentMode = getDragSelectMode(e);
    this._isDragging = false;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.dragStart) return;
    const dx = Math.abs(e.clientX - this.dragStart.x);
    const dy = Math.abs(e.clientY - this.dragStart.y);
    if (dx < this.minDragPx && dy < this.minDragPx) return;
    this._isDragging = true;
    this.updateOverlay(this.dragStart.x, this.dragStart.y, e.clientX, e.clientY, this.currentMode);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.dragStart) return;

    const start = this.dragStart;
    const mode  = this.currentMode;
    this.cleanup();

    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);

    if (dx < this.minDragPx && dy < this.minDragPx) {
      this.opts.onClickEmpty?.();
      return;
    }

    const frustum = buildFrustum(
      this.opts.domElement,
      start.x, start.y,
      e.clientX, e.clientY,
      this.opts.getCamera(),
    );
    this.opts.onSelect(frustum, mode);
  };

  // ── Overlay ────────────────────────────────────────────────────────────────

  private updateOverlay(
    x0: number, y0: number,
    x1: number, y1: number,
    mode: DragSelectMode,
  ): void {
    if (!this.overlayEl) {
      const div = document.createElement('div');
      Object.assign(div.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '9999',
        boxSizing: 'border-box',
      });
      document.body.appendChild(div);
      this.overlayEl = div;
    }
    const { border, bg } = OVERLAY_STYLE[mode];
    Object.assign(this.overlayEl.style, {
      border: `1px solid ${border}`,
      backgroundColor: bg,
      left:   `${Math.min(x0, x1)}px`,
      top:    `${Math.min(y0, y1)}px`,
      width:  `${Math.abs(x1 - x0)}px`,
      height: `${Math.abs(y1 - y0)}px`,
    });
  }

  private cleanup(): void {
    this.dragStart = null;
    this._isDragging = false;
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  }
}
