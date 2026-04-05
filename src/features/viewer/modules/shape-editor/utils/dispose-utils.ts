import { Mesh, Line, LineSegments, Object3D, BufferGeometry, Material } from 'three';

/** Recursively dispose geometry and materials on all descendants. */
export function disposeObject3D(obj: Object3D): void {
  obj.traverse((child) => {
    if (child instanceof Mesh || child instanceof Line || child instanceof LineSegments) {
      if (child.geometry instanceof BufferGeometry) {
        child.geometry.dispose();
      }
      disposeMaterial(child.material);
    }
  });
}

function disposeMaterial(mat: Material | Material[]): void {
  if (Array.isArray(mat)) {
    mat.forEach((m) => m.dispose());
  } else {
    mat.dispose();
  }
}

/** Remove all children from a group, disposing their geometry/materials. */
export function clearGroup(group: Object3D): void {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeObject3D(child);
  }
}
