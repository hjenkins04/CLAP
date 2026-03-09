import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface TransformState {
  /** Whether translation snaps to grid */
  translateSnapEnabled: boolean;
  /** Translation snap increment in meters */
  translateSnapValue: number;

  /** Whether rotation snaps to fixed degrees */
  rotateSnapEnabled: boolean;
  /** Rotation snap increment in degrees */
  rotateSnapDegrees: number;

  /** Current point cloud position (read-only display) */
  positionX: number;
  positionY: number;
  positionZ: number;
  /** Current point cloud rotation in degrees (read-only display) */
  rotationX: number;
  rotationY: number;
  rotationZ: number;

  setTranslateSnapEnabled: (enabled: boolean) => void;
  setTranslateSnapValue: (value: number) => void;
  setRotateSnapEnabled: (enabled: boolean) => void;
  setRotateSnapDegrees: (degrees: number) => void;
  setPosition: (x: number, y: number, z: number) => void;
  setRotation: (x: number, y: number, z: number) => void;
  resetTransform: () => void;
}

export const useTransformStore = create<TransformState>()(
  persist(
    (set) => ({
      translateSnapEnabled: false,
      translateSnapValue: 1,

      rotateSnapEnabled: false,
      rotateSnapDegrees: 15,

      positionX: 0,
      positionY: 0,
      positionZ: 0,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,

      setTranslateSnapEnabled: (translateSnapEnabled) =>
        set({ translateSnapEnabled }),
      setTranslateSnapValue: (translateSnapValue) =>
        set({ translateSnapValue }),
      setRotateSnapEnabled: (rotateSnapEnabled) => set({ rotateSnapEnabled }),
      setRotateSnapDegrees: (rotateSnapDegrees) => set({ rotateSnapDegrees }),
      setPosition: (positionX, positionY, positionZ) =>
        set({ positionX, positionY, positionZ }),
      setRotation: (rotationX, rotationY, rotationZ) =>
        set({ rotationX, rotationY, rotationZ }),
      resetTransform: () =>
        set({
          positionX: 0,
          positionY: 0,
          positionZ: 0,
          rotationX: 0,
          rotationY: 0,
          rotationZ: 0,
        }),
    }),
    {
      name: 'clap-plugin-transform',
      partialize: (state) => ({
        translateSnapEnabled: state.translateSnapEnabled,
        translateSnapValue: state.translateSnapValue,
        rotateSnapEnabled: state.rotateSnapEnabled,
        rotateSnapDegrees: state.rotateSnapDegrees,
      }),
    }
  )
);
