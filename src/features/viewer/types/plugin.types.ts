import type { Scene, Camera, WebGLRenderer, Group } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PointCloudOctree } from 'potree-core';
import type { ComponentType } from 'react';
import type { PointCloudEditor } from '../services/point-cloud-editor';
import type { DemTerrain } from '../services/dem-terrain';

export interface PluginHost {
  getPlugin<T extends ViewerPlugin>(id: string): T | undefined;
  getPlugins(): ViewerPlugin[];
}

export interface ViewerPluginContext {
  scene: Scene;
  /** The world-space root group. Add scene objects here instead of directly
   *  to `scene` so that axis flips applied to this group affect everything. */
  worldRoot: Group;
  getActiveCamera: () => Camera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  getPointClouds: () => PointCloudOctree[];
  getEditor: () => PointCloudEditor;
  getDem: () => DemTerrain | null;
  domElement: HTMLElement;
  container: HTMLElement;
  host: PluginHost;
  /** Base URL of the currently loaded point cloud (e.g. "/pointclouds/my_scan/").
   *  Null until a point cloud has been loaded. */
  getBaseUrl: () => string | null;
  /**
   * Run a Potree LOD update pass with a custom camera. Call this from
   * `onAfterRender` to drive async node loading for secondary viewports.
   * The result only affects which geometry nodes get queued for download;
   * it does not change what the primary viewport renders on this frame.
   */
  updatePointCloudsForCamera: (camera: Camera) => void;
}

export interface ViewerPlugin {
  readonly id: string;
  readonly name: string;
  readonly order?: number;

  onInit(ctx: ViewerPluginContext): void;
  onUpdate?(delta: number): void;
  onAfterRender?(): void;
  onResize?(width: number, height: number): void;
  onPointCloudLoaded?(pco: PointCloudOctree): void;
  onPointCloudsUnloaded?(): void;
  dispose(): void;

  SidebarPanel?: ComponentType;
  sidebarTitle?: string;
  sidebarDefaultOpen?: boolean;
}
