import {
  Scene,
  Group,
  PerspectiveCamera,
  OrthographicCamera,
  WebGLRenderer,
  Vector3,
  Box3,
  AmbientLight,
  MOUSE,
  type Camera,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Potree, PointCloudOctree, PotreeRenderer } from 'potree-core';
import {
  COLOR_MODE_MAP,
  type ColorMode,
  type CameraProjection,
  type ViewerConfig,
  type ViewerPlugin,
  type ViewerPluginContext,
  type PluginHost,
} from '../types';
import { PointCloudEditor } from './point-cloud-editor';
import { DemTerrain } from './dem-terrain';
import { electronFetch } from './electron-fetch';
import { loadGeometryAnnotations } from './geometry-annotations-io';
import { geoAnnotHistory } from './geometry-annotations-history';

export class ViewerEngine implements PluginHost {
  private scene: Scene;
  private worldRoot: Group;
  private perspCamera: PerspectiveCamera;
  private orthoCamera: OrthographicCamera;
  private activeCamera: Camera;
  private projection: CameraProjection;
  private renderer: WebGLRenderer;
  private controls: OrbitControls;
  private potree: Potree;
  private potreeRenderer: PotreeRenderer;
  private pointClouds: PointCloudOctree[] = [];
  private tilePcos: Map<string, PointCloudOctree> = new Map();
  private editor: PointCloudEditor;
  private plugins: Map<string, ViewerPlugin> = new Map();
  private pluginCtx: ViewerPluginContext;
  private pcBaseUrl: string | null = null;
  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;
  private container: HTMLElement;
  private activeColorMode: ColorMode = 'rgb';
  private intensityRange: [number, number] | null = null;
  private intensityRangeRefined = false;
  private dem: DemTerrain | null = null;
  private onStatsUpdate?: (numVisiblePoints: number) => void;
  private readonly onModifierDown: (e: KeyboardEvent) => void;
  private readonly onModifierUp: (e: KeyboardEvent) => void;

  constructor(
    container: HTMLElement,
    config: ViewerConfig,
    plugins: ViewerPlugin[] = []
  ) {
    this.container = container;
    this.container.style.position = 'relative';
    this.projection = config.cameraProjection;

    this.scene = new Scene();
    this.scene.add(new AmbientLight(0xffffff));

    this.worldRoot = new Group();
    this.worldRoot.name = 'worldRoot';
    this.scene.add(this.worldRoot);

    const { width, height } = container.getBoundingClientRect();
    const aspect = width / height || 1;

    this.perspCamera = new PerspectiveCamera(60, aspect, 0.1, 10000);
    this.perspCamera.position.set(0, 50, 100);

    const frustumHalf = 50;
    this.orthoCamera = new OrthographicCamera(
      -frustumHalf * aspect,
      frustumHalf * aspect,
      frustumHalf,
      -frustumHalf,
      0.1,
      10000
    );
    this.orthoCamera.position.copy(this.perspCamera.position);

    this.activeCamera =
      this.projection === 'orthographic' ? this.orthoCamera : this.perspCamera;

    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      precision: 'highp',
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(
      this.activeCamera,
      this.renderer.domElement
    );
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    // Free LMB for selection/drawing — orbit on MMB, pan on RMB
    this.controls.mouseButtons = {
      LEFT: null as unknown as MOUSE,
      MIDDLE: MOUSE.ROTATE,
      RIGHT: MOUSE.PAN,
    };

    // Ctrl+Shift+LMB = orbit (laptop alternative for no middle mouse button)
    const syncOrbitModifier = (e: KeyboardEvent) => {
      this.controls.mouseButtons.LEFT =
        e.ctrlKey && e.shiftKey
          ? MOUSE.ROTATE
          : (null as unknown as MOUSE);
    };
    this.onModifierDown = syncOrbitModifier;
    this.onModifierUp = syncOrbitModifier;
    window.addEventListener('keydown', this.onModifierDown);
    window.addEventListener('keyup', this.onModifierUp);

    this.potree = new Potree();
    this.potree.pointBudget = config.pointBudget;

    this.potreeRenderer = new PotreeRenderer({
      edl: {
        enabled: config.edlEnabled,
        pointCloudLayer: 1,
        strength: config.edlStrength,
        radius: config.edlRadius,
        opacity: 1.0,
      },
    });

    this.editor = new PointCloudEditor();

    // Build plugin context
    this.pluginCtx = {
      scene: this.scene,
      worldRoot: this.worldRoot,
      getActiveCamera: () => this.activeCamera,
      renderer: this.renderer,
      controls: this.controls,
      getPointClouds: () => this.pointClouds,
      getEditor: () => this.editor,
      getDem: () => this.dem,
      domElement: this.renderer.domElement,
      container: this.container,
      host: this,
      getBaseUrl: () => this.pcBaseUrl,
      updatePointCloudsForCamera: (camera: Camera) => {
        this.potree.updatePointClouds(this.pointClouds, camera, this.renderer);
      },
    };

    // Register plugins
    for (const plugin of plugins) {
      this.registerPlugin(plugin);
    }

    this.startRenderLoop();
  }

  // --- Editor ---

  getEditor(): PointCloudEditor {
    return this.editor;
  }

  // --- Plugin Host ---

  registerPlugin(plugin: ViewerPlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[CLAP] Plugin "${plugin.id}" already registered`);
      return;
    }
    this.plugins.set(plugin.id, plugin);
    plugin.onInit(this.pluginCtx);
  }

  getPlugin<T extends ViewerPlugin>(id: string): T | undefined {
    return this.plugins.get(id) as T | undefined;
  }

  getPlugins(): ViewerPlugin[] {
    return Array.from(this.plugins.values()).sort(
      (a, b) => (a.order ?? 999) - (b.order ?? 999)
    );
  }

  // --- Point Cloud ---

  async loadPointCloud(url: string, baseUrl: string): Promise<void> {
    this.pcBaseUrl = baseUrl;
    const requestManager = {
      getUrl: async (relativeUrl: string) => `${baseUrl}${relativeUrl}`,
      fetch: electronFetch,
    };
    const pco = await this.potree.loadPointCloud(url, requestManager);

    pco.material.size = 0.1;
    pco.material.minSize = 1.5;
    pco.material.maxSize = 12; // cap adaptive size — sparse nodes would otherwise balloon to 50px
    pco.material.shape = 2; // PARABOLOID
    pco.material.inputColorEncoding = 1; // sRGB
    pco.material.outputColorEncoding = 1; // sRGB
    pco.showBoundingBox = false;

    // Read intensity range from metadata (initial estimate)
    await this.loadIntensityRangeFromMetadata(baseUrl, url);
    if (this.intensityRange) {
      pco.material.intensityRange = this.intensityRange;
    }

    // Apply gamma to spread mid-tones for better intensity visualization
    pco.material.intensityGamma = 0.6;

    // Classification colours are applied by annotate-plugin.onPointCloudLoaded
    // using the currently loaded legend (+ any user visibility toggles).

    this.worldRoot.add(pco);
    this.pointClouds.push(pco);

    // Attach the editor — reparents PCO into the editor's transform group
    await this.editor.attach(pco, this.worldRoot, baseUrl);

    // Load geometry annotations (polygons + static obstacles) if the file exists,
    // then reset undo history so the loaded state is the clean baseline.
    await loadGeometryAnnotations(baseUrl);
    geoAnnotHistory.reset();
    geoAnnotHistory.markSaved();

    this.fitCameraToPointCloud(pco);

    for (const plugin of this.plugins.values()) {
      plugin.onPointCloudLoaded?.(pco);
    }
  }

  // --- Tiled datasets (multi-PCO) ---

  /**
   * Load a single tile as an additional PointCloudOctree. Used for tiled
   * datasets where many PCOs coexist in the scene and the user enables/disables
   * them explicitly. Does not call editor.attach() — the editor is scoped to
   * single-PCO workflows and annotation editing on tiled datasets is not
   * supported yet.
   *
   * If this is the first tile loaded, sets baseUrl and fits the camera to it.
   * Subsequent tiles are just added to the scene without recentring.
   */
  async loadTile(
    tileId: string,
    metadataUrl: string,
    baseUrl: string,
  ): Promise<void> {
    if (this.tilePcos.has(tileId)) return;

    this.pcBaseUrl = baseUrl;
    const requestManager = {
      getUrl: async (relativeUrl: string) => `${baseUrl}${relativeUrl}`,
      fetch: electronFetch,
    };
    const pco = await this.potree.loadPointCloud(metadataUrl, requestManager);
    pco.name = `tile:${tileId}`;
    pco.userData.tileId = tileId;

    pco.material.size = 0.1;
    pco.material.minSize = 1.5;
    pco.material.maxSize = 12;
    pco.material.shape = 2;
    pco.material.inputColorEncoding = 1;
    pco.material.outputColorEncoding = 1;
    pco.showBoundingBox = false;

    if (this.intensityRange) {
      pco.material.intensityRange = this.intensityRange;
    }
    pco.material.intensityGamma = 0.6;

    // Classification colours: applied by annotate-plugin on onPointCloudLoaded.

    // Match colour mode to whatever the rest of the scene is using
    pco.material.pointColorType = COLOR_MODE_MAP[this.activeColorMode];

    this.worldRoot.add(pco);
    this.pointClouds.push(pco);
    this.tilePcos.set(tileId, pco);

    const isFirst = this.pointClouds.length === 1;
    if (isFirst) {
      this.fitCameraToPointCloud(pco);
    }

    for (const plugin of this.plugins.values()) {
      plugin.onPointCloudLoaded?.(pco);
    }
  }

  unloadTile(tileId: string): void {
    const pco = this.tilePcos.get(tileId);
    if (!pco) return;
    this.tilePcos.delete(tileId);

    const idx = this.pointClouds.indexOf(pco);
    if (idx >= 0) this.pointClouds.splice(idx, 1);

    if (pco.parent) pco.parent.remove(pco);
    pco.dispose();

    if (this.pointClouds.length === 0) {
      for (const plugin of this.plugins.values()) {
        plugin.onPointCloudsUnloaded?.();
      }
      this.intensityRangeRefined = false;
    }
  }

  getLoadedTileIds(): string[] {
    return [...this.tilePcos.keys()];
  }

  fitCameraToLoadedTiles(): void {
    if (this.pointClouds.length === 0) return;

    const transformGroup = this.editor.getTransformGroup();
    transformGroup.updateMatrixWorld(true);

    const worldBox = new Box3();
    for (const pco of this.pointClouds) {
      const localBox = pco.pcoGeometry.boundingBox;
      const corners = [
        new Vector3(localBox.min.x, localBox.min.y, localBox.min.z),
        new Vector3(localBox.min.x, localBox.min.y, localBox.max.z),
        new Vector3(localBox.min.x, localBox.max.y, localBox.min.z),
        new Vector3(localBox.min.x, localBox.max.y, localBox.max.z),
        new Vector3(localBox.max.x, localBox.min.y, localBox.min.z),
        new Vector3(localBox.max.x, localBox.min.y, localBox.max.z),
        new Vector3(localBox.max.x, localBox.max.y, localBox.min.z),
        new Vector3(localBox.max.x, localBox.max.y, localBox.max.z),
      ];
      for (const corner of corners) {
        corner.add(pco.position);
        corner.applyMatrix4(transformGroup.matrixWorld);
        worldBox.expandByPoint(corner);
      }
    }

    const center = worldBox.getCenter(new Vector3());
    const size = worldBox.getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 1.2;

    const camPos = new Vector3(
      center.x + distance * 0.5,
      center.y + distance * 0.5,
      center.z + distance * 0.5,
    );

    this.perspCamera.position.copy(camPos);
    this.perspCamera.near = distance * 0.001;
    this.perspCamera.far = distance * 10;
    this.perspCamera.updateProjectionMatrix();

    this.orthoCamera.position.copy(camPos);
    this.orthoCamera.near = distance * 0.001;
    this.orthoCamera.far = distance * 10;

    this.controls.target.copy(center);
    this.controls.update();
    this.syncOrthoFrustum();
  }

  async loadDem(url: string): Promise<void> {
    if (this.dem) {
      this.dem.dispose();
      this.dem = null;
    }
    try {
      this.dem = await DemTerrain.load(url);
      // Add the DEM mesh to the transform group so it shares the
      // same local→world transform as the point cloud.
      const tg = this.editor.getTransformGroup();
      tg.add(this.dem.mesh);
      console.info('[CLAP] DEM loaded:', url);
    } catch (err) {
      console.warn('[CLAP] DEM load failed:', err);
    }
  }

  getDem(): DemTerrain | null {
    return this.dem;
  }

  unloadAll(): void {
    for (const plugin of this.plugins.values()) {
      plugin.onPointCloudsUnloaded?.();
    }
    this.editor.detach();
    this.pointClouds.forEach((pco) => {
      if (pco.parent) pco.parent.remove(pco);
      pco.dispose();
    });
    this.pointClouds = [];
    this.tilePcos.clear();
    this.intensityRange = null;
    this.intensityRangeRefined = false;
    if (this.dem) {
      this.dem.dispose();
      this.dem = null;
    }
  }

  // --- Settings ---

  setPointCloudVisible(visible: boolean): void {
    this.pointClouds.forEach((pco) => {
      pco.visible = visible;
    });
  }

  setPointSize(size: number): void {
    this.pointClouds.forEach((pco) => {
      pco.material.size = size;
    });
  }

  setPointBudget(budget: number): void {
    this.potree.pointBudget = budget;
  }

  setColorMode(mode: ColorMode): void {
    this.activeColorMode = mode;
    const colorType = COLOR_MODE_MAP[mode];
    this.pointClouds.forEach((pco) => {
      pco.material.pointColorType = colorType;

      if (mode === 'intensity' && this.intensityRange) {
        pco.material.intensityRange = this.intensityRange;
      }
    });
  }

  setEdl(enabled: boolean, strength?: number, radius?: number): void {
    this.potreeRenderer.setEDL({
      enabled,
      ...(strength !== undefined && { strength }),
      ...(radius !== undefined && { radius }),
    });
  }

  setCameraProjection(projection: CameraProjection): void {
    if (projection === this.projection) return;
    this.projection = projection;

    const oldPos = (
      this.activeCamera as PerspectiveCamera | OrthographicCamera
    ).position.clone();
    const target = this.controls.target.clone();

    if (projection === 'orthographic') {
      this.orthoCamera.position.copy(oldPos);
      this.syncOrthoFrustum();
      this.activeCamera = this.orthoCamera;
    } else {
      this.perspCamera.position.copy(oldPos);
      this.activeCamera = this.perspCamera;
    }

    this.controls.object = this.activeCamera;
    this.controls.target.copy(target);
    this.controls.update();
  }

  setOnStatsUpdate(callback: (numVisiblePoints: number) => void): void {
    this.onStatsUpdate = callback;
  }

  resize(): void {
    const { width, height } = this.container.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    const aspect = width / height;
    this.renderer.setSize(width, height);

    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();

    this.syncOrthoFrustum();

    for (const plugin of this.plugins.values()) {
      plugin.onResize?.(width, height);
    }
  }

  dispose(): void {
    this.stopRenderLoop();

    // Dispose plugins in reverse order
    const pluginList = Array.from(this.plugins.values()).reverse();
    for (const plugin of pluginList) {
      plugin.dispose();
    }
    this.plugins.clear();

    this.unloadAll();
    window.removeEventListener('keydown', this.onModifierDown);
    window.removeEventListener('keyup', this.onModifierUp);
    this.controls.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(
        this.renderer.domElement
      );
    }
  }

  // --- Private ---

  private syncOrthoFrustum(): void {
    const { width, height } = this.container.getBoundingClientRect();
    const aspect = width / height || 1;
    const distance = this.orthoCamera.position.distanceTo(
      this.controls.target
    );
    const halfHeight = distance * Math.tan((60 * Math.PI) / 360);

    this.orthoCamera.left = -halfHeight * aspect;
    this.orthoCamera.right = halfHeight * aspect;
    this.orthoCamera.top = halfHeight;
    this.orthoCamera.bottom = -halfHeight;
    this.orthoCamera.near = this.perspCamera.near;
    this.orthoCamera.far = this.perspCamera.far;
    this.orthoCamera.updateProjectionMatrix();
  }

  private fitCameraToPointCloud(pco: PointCloudOctree): void {
    const localBox = pco.pcoGeometry.boundingBox;

    // Build a world-space bounding box that accounts for the editor's
    // transform group (rotation/translation applied to the PCO).
    const transformGroup = this.editor.getTransformGroup();
    transformGroup.updateMatrixWorld(true);

    const worldBox = new Box3();
    const corners = [
      new Vector3(localBox.min.x, localBox.min.y, localBox.min.z),
      new Vector3(localBox.min.x, localBox.min.y, localBox.max.z),
      new Vector3(localBox.min.x, localBox.max.y, localBox.min.z),
      new Vector3(localBox.min.x, localBox.max.y, localBox.max.z),
      new Vector3(localBox.max.x, localBox.min.y, localBox.min.z),
      new Vector3(localBox.max.x, localBox.min.y, localBox.max.z),
      new Vector3(localBox.max.x, localBox.max.y, localBox.min.z),
      new Vector3(localBox.max.x, localBox.max.y, localBox.max.z),
    ];
    for (const corner of corners) {
      // Local → add PCO offset → transform through group world matrix
      corner.add(pco.position);
      corner.applyMatrix4(transformGroup.matrixWorld);
      worldBox.expandByPoint(corner);
    }

    const center = worldBox.getCenter(new Vector3());
    const size = worldBox.getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 1.2;

    const camPos = new Vector3(
      center.x + distance * 0.5,
      center.y + distance * 0.5,
      center.z + distance * 0.5
    );

    this.perspCamera.position.copy(camPos);
    this.perspCamera.near = distance * 0.001;
    this.perspCamera.far = distance * 10;
    this.perspCamera.updateProjectionMatrix();

    this.orthoCamera.position.copy(camPos);
    this.orthoCamera.near = distance * 0.001;
    this.orthoCamera.far = distance * 10;

    this.controls.target.copy(center);
    this.controls.update();

    this.syncOrthoFrustum();
  }

  private async loadIntensityRangeFromMetadata(
    baseUrl: string,
    metadataUrl: string
  ): Promise<void> {
    try {
      const resp = await electronFetch(`${baseUrl}${metadataUrl}`);
      if (!resp.ok) return;

      const metadata = await resp.json();
      const attrs = metadata.attributes as
        | { name: string; min?: number[]; max?: number[] }[]
        | undefined;
      if (!attrs) return;

      const intensityAttr = attrs.find(
        (a) => a.name.toLowerCase() === 'intensity'
      );
      if (
        !intensityAttr?.min?.length ||
        !intensityAttr?.max?.length ||
        intensityAttr.min[0] >= intensityAttr.max[0]
      ) {
        return;
      }

      this.intensityRange = [intensityAttr.min[0], intensityAttr.max[0]];
    } catch {
      // Metadata fetch failed — intensity range stays null
    }
  }

  /**
   * Scans loaded geometry nodes to compute a percentile-based intensity range.
   * Uses 2nd–98th percentile to exclude outliers and provide better contrast.
   */
  private refineIntensityRange(): void {
    if (this.intensityRangeRefined) return;

    const samples: number[] = [];
    for (const pco of this.pointClouds) {
      for (const node of pco.visibleNodes) {
        const geom = node.sceneNode?.geometry;
        if (!geom) continue;
        const attr = geom.getAttribute('intensity');
        if (!attr) continue;
        const arr = attr.array as Float32Array;
        // Sample up to 2000 values per node to keep it fast
        const step = Math.max(1, Math.floor(arr.length / 2000));
        for (let i = 0; i < arr.length; i += step) {
          samples.push(arr[i]);
        }
      }
    }

    if (samples.length < 100) return;

    samples.sort((a, b) => a - b);
    const lo = samples[Math.floor(samples.length * 0.02)];
    const hi = samples[Math.floor(samples.length * 0.98)];

    if (hi <= lo) return;

    this.intensityRange = [lo, hi];
    this.intensityRangeRefined = true;

    // Apply to all loaded materials
    for (const pco of this.pointClouds) {
      pco.material.intensityRange = this.intensityRange;
    }
  }

  private startRenderLoop(): void {
    this.lastFrameTime = performance.now();
    const loop = () => {
      this.animationFrameId = requestAnimationFrame(loop);
      this.render();
    };
    loop();
  }

  private stopRenderLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private render(): void {
    const now = performance.now();
    const delta = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    this.controls.update();

    const result = this.potree.updatePointClouds(
      this.pointClouds,
      this.activeCamera,
      this.renderer
    );

    if (this.onStatsUpdate && result) {
      this.onStatsUpdate(result.numVisiblePoints);
    }

    // Refine intensity range from actual loaded geometry (runs once)
    if (!this.intensityRangeRefined && this.pointClouds.length > 0) {
      this.refineIntensityRange();
    }

    // Update editor visuals (patch newly loaded nodes)
    this.editor.frameUpdate();

    // Plugin pre-render
    for (const plugin of this.plugins.values()) {
      plugin.onUpdate?.(delta);
    }

    this.potreeRenderer.render({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.activeCamera,
      pointClouds: this.pointClouds,
    });

    // Plugin post-render
    for (const plugin of this.plugins.values()) {
      plugin.onAfterRender?.();
    }
  }
}
