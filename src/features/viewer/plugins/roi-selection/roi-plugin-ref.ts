import type { RoiSelectionPlugin } from './roi-plugin';

let _ref: RoiSelectionPlugin | null = null;

export function setRoiPluginRef(p: RoiSelectionPlugin | null): void {
  _ref = p;
}

export function getRoiPlugin(): RoiSelectionPlugin | null {
  return _ref;
}
