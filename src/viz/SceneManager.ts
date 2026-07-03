import * as THREE from "three";
import { isWPlotable } from "../core/curveSample";
import { CurvePoint, FieldData, GridLine, Region, ViewMode } from "../core/field";
import { IsolineSegment } from "../core/function";
import { AxisOverlay } from "./AxisOverlay";
import { CameraController } from "./CameraController";
import { OrbitController } from "./OrbitController";

const MANIM_BG = 0x0e0e12;
const MANIM_BLUE = 0x58c4dd;
const MANIM_GOLD = 0xffd166;
const GRID_Z = 0x3a3a48;

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private orthoCamera: THREE.OrthographicCamera;
  private perspCamera: THREE.PerspectiveCamera;
  private contentGroup = new THREE.Group();
  private phasePivot = new THREE.Group();
  private domainMesh: THREE.Mesh;
  private domainMat: THREE.MeshBasicMaterial;
  private domainTex: THREE.DataTexture;
  private gridGroup = new THREE.Group();
  private overlayGroup = new THREE.Group();
  private phaseMesh: THREE.Mesh | null = null;
  private phaseWire: THREE.LineSegments | null = null;
  private axes: THREE.Group;
  private unitCircle: THREE.Line;
  private viewMode: ViewMode = "domain";
  private region: Region = { xMin: -2.5, xMax: 2.5, yMin: -2.5, yMax: 2.5 };
  private baseScale = { x: 1, y: 1 };
  private basePos = new THREE.Vector3();
  private cameraCtrl: CameraController;
  private orbitCtrl: OrbitController;
  private axisOverlay: AxisOverlay;
  private aspect = 1;
  private canvasW = 1;
  private canvasH = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(MANIM_BG, 1);

    this.scene = new THREE.Scene();
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.orthoCamera.position.set(0, 0, 5);

    this.perspCamera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
    this.perspCamera.position.set(2.2, 2.0, 2.8);

    this.scene.add(this.contentGroup);
    this.scene.add(this.phasePivot);

    this.domainTex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    this.domainMat = new THREE.MeshBasicMaterial({ map: this.domainTex, transparent: false });
    this.domainMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.domainMat);
    this.contentGroup.add(this.domainMesh);

    this.axes = new THREE.Group();
    this.contentGroup.add(this.axes);

    const circlePts: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const t = (i / 128) * Math.PI * 2;
      circlePts.push(new THREE.Vector3(Math.cos(t), Math.sin(t), 0.01));
    }
    this.unitCircle = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(circlePts),
      new THREE.LineBasicMaterial({ color: MANIM_GOLD, transparent: true, opacity: 0.35 }),
    );
    this.contentGroup.add(this.unitCircle);

    this.contentGroup.add(this.gridGroup);
    this.contentGroup.add(this.overlayGroup);

    const amb = new THREE.AmbientLight(0x505070, 0.65);
    const dir = new THREE.DirectionalLight(0xffffff, 1.15);
    dir.position.set(3, 4, 5);
    this.scene.add(amb, dir);

    this.cameraCtrl = new CameraController(canvas, () => this.applyPanZoom(), () => this.resetCamera());
    this.orbitCtrl = new OrbitController(this.perspCamera, canvas);
    this.axisOverlay = new AxisOverlay(canvas.parentElement!);
    canvas.style.cursor = "grab";

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private applyPanZoom(): void {
    const s = this.cameraCtrl.state;
    this.contentGroup.position.set(s.panX, s.panY, 0);
    this.contentGroup.scale.set(s.zoom, s.zoom, 1);
    this.drawAxisOverlay();
  }

  private activeCamera(): THREE.Camera {
    return this.viewMode === "phase" ? this.perspCamera : this.orthoCamera;
  }

  resetCamera(): void {
    if (this.viewMode === "phase") this.orbitCtrl.reset();
    else this.cameraCtrl.reset();
  }

  resize(): void {
    const parent = this.canvas.parentElement!;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.canvasW = w;
    this.canvasH = h;
    this.renderer.setSize(w, h, false);
    this.axisOverlay.resize(w, h);
    this.aspect = w / h;
    this.orthoCamera.left = -this.aspect;
    this.orthoCamera.right = this.aspect;
    this.orthoCamera.top = 1;
    this.orthoCamera.bottom = -1;
    this.orthoCamera.updateProjectionMatrix();
    this.perspCamera.aspect = this.aspect;
    this.perspCamera.updateProjectionMatrix();
    this.drawAxisOverlay();
  }

  setRegion(region: Region): void {
    this.region = region;
    const sx = 2 / (region.xMax - region.xMin);
    const sy = 2 / (region.yMax - region.yMin);
    const cx = (region.xMin + region.xMax) / 2;
    const cy = (region.yMin + region.yMax) / 2;
    this.baseScale = { x: sx, y: sy };
    this.basePos.set(-cx * sx, -cy * sy, 0);

    this.domainMesh.scale.set(sx, sy, 1);
    this.domainMesh.position.copy(this.basePos);
    this.gridGroup.scale.set(sx, sy, 1);
    this.gridGroup.position.copy(this.basePos);
    this.overlayGroup.scale.set(sx, sy, 1);
    this.overlayGroup.position.copy(this.basePos);
    this.unitCircle.scale.set(sx, sy, 1);
    this.unitCircle.position.set(this.basePos.x, this.basePos.y, 0.01);

    this.syncPhaseTransform();
    this.drawAxisOverlay();
  }

  private syncPhaseTransform(): void {
    this.phasePivot.position.copy(this.basePos);
    this.phasePivot.scale.set(this.baseScale.x, this.baseScale.y, 1);
  }

  setViewMode(mode: ViewMode): void {
    const wasPhase = this.viewMode === "phase";
    this.viewMode = mode;
    const isPhase = mode === "phase";
    const isCurve = mode === "curve" || mode === "func-curves";

    this.cameraCtrl.setEnabled(!isPhase);
    this.orbitCtrl.setEnabled(isPhase);

    const showField = ["domain", "contour", "phase", "func-domain"].includes(mode);
    this.domainMesh.visible = showField;
    this.gridGroup.visible = mode === "grid";
    this.overlayGroup.visible = mode === "func-isolines" || isCurve;
    this.unitCircle.visible = !isPhase && mode !== "curve";
    this.axes.visible = !isPhase;

    if (mode === "func-isolines") this.domainMesh.visible = false;
    if (mode === "curve") this.domainMesh.visible = false;

    this.phasePivot.visible = isPhase;
    this.contentGroup.visible = !isPhase;

    if (isPhase) {
      this.ensurePhaseMesh();
      if (!wasPhase) this.orbitCtrl.reset();
    }
    this.drawAxisOverlay();
  }

  private ensurePhaseMesh(): void {
    if (this.phaseMesh) return;
    const geo = new THREE.PlaneGeometry(2, 2, 64, 64);
    const mat = new THREE.MeshStandardMaterial({
      color: MANIM_BLUE,
      metalness: 0.15,
      roughness: 0.5,
      side: THREE.DoubleSide,
      flatShading: false,
    });
    this.phaseMesh = new THREE.Mesh(geo, mat);
    this.phaseWire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }),
    );
    this.phasePivot.add(this.phaseMesh, this.phaseWire);
    this.syncPhaseTransform();
  }

  updateField(field: FieldData): void {
    if (this.domainTex.image.width !== field.width || this.domainTex.image.height !== field.height) {
      this.domainTex.dispose();
      const data = Uint8Array.from(field.rgba);
      this.domainTex = new THREE.DataTexture(data, field.width, field.height, THREE.RGBAFormat);
      this.domainMat.map = this.domainTex;
      this.domainMat.needsUpdate = true;
    } else {
      (this.domainTex.image as { data: Uint8Array }).data.set(field.rgba);
    }
    this.domainTex.needsUpdate = true;

    if (this.phaseMesh) {
      const pos = this.phaseMesh.geometry.attributes.position as THREE.BufferAttribute;
      const n = field.width;
      let maxH = 0.01;
      for (let j = 0; j <= 64; j++) {
        for (let i = 0; i <= 64; i++) {
          const fi = Math.floor((i / 64) * (n - 1));
          const fj = Math.floor((j / 64) * (n - 1));
          const mag = field.magnitude[fj * n + fi];
          const h = isFinite(mag) ? Math.log1p(mag) * 0.22 : 0;
          maxH = Math.max(maxH, h);
          pos.setZ(j * 65 + i, h);
        }
      }
      pos.needsUpdate = true;
      this.phaseMesh.geometry.computeVertexNormals();
      if (this.phaseWire) {
        this.phaseWire.geometry.dispose();
        this.phaseWire.geometry = new THREE.WireframeGeometry(this.phaseMesh.geometry);
      }
      void maxH;
    }
  }

  updateGridMorph(
    from: { horizontal: GridLine[]; vertical: GridLine[] },
    to: { horizontal: GridLine[]; vertical: GridLine[] },
    morphT = 1,
  ): void {
    this.clearGroup(this.gridGroup);
    const addLines = (
      fromLines: GridLine[],
      toLines: GridLine[],
      color: number,
    ) => {
      const count = Math.min(fromLines.length, toLines.length);
      for (let li = 0; li < count; li++) {
        const fromLine = fromLines[li];
        const toLine = toLines[li];
        const pts: THREE.Vector3[] = [];
        const n = Math.min(fromLine.points.length, toLine.points.length);
        for (let pi = 0; pi < n; pi++) {
          const fp = fromLine.points[pi];
          const tp = toLine.points[pi];
          const x = lerp(fp.wx, tp.wx, morphT);
          const y = lerp(fp.wy, tp.wy, morphT);
          if (isFinite(x) && isFinite(y) && Math.hypot(x, y) < 30) pts.push(new THREE.Vector3(x, y, 0.02));
        }
        if (pts.length < 2) continue;
        this.gridGroup.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
          ),
        );
      }
    };
    addLines(from.horizontal, to.horizontal, MANIM_BLUE);
    addLines(from.vertical, to.vertical, 0xfc6255);
  }

  updateGrid(horizontal: GridLine[], vertical: GridLine[], showDeformed: boolean, morphT = 1): void {
    this.clearGroup(this.gridGroup);
    const addLines = (lines: GridLine[], color: number, deformed: boolean) => {
      for (const line of lines) {
        const pts: THREE.Vector3[] = [];
        for (const p of line.points) {
          const x = deformed ? lerp(p.x, p.wx, morphT) : p.x;
          const y = deformed ? lerp(p.y, p.wy, morphT) : p.y;
          if (isFinite(x) && isFinite(y) && Math.hypot(x, y) < 30) pts.push(new THREE.Vector3(x, y, 0.02));
        }
        if (pts.length < 2) continue;
        this.gridGroup.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: deformed ? 0.9 : 0.45 }),
          ),
        );
      }
    };
    if (showDeformed) {
      addLines(horizontal, MANIM_BLUE, true);
      addLines(vertical, 0xfc6255, true);
    } else {
      addLines(horizontal, GRID_Z, false);
      addLines(vertical, GRID_Z, false);
    }
  }

  updatePipelineCurveMorph(from: CurvePoint[], to: CurvePoint[], morphT = 1): void {
    this.clearGroup(this.overlayGroup);
    const n = Math.min(from.length, to.length);
    this.drawPipelineCurves(to.slice(0, n), morphT, from.slice(0, n));
  }

  updatePipelineCurve(points: CurvePoint[], morphT = 1): void {
    this.clearGroup(this.overlayGroup);
    this.drawPipelineCurves(points, morphT);
  }

  private drawPipelineCurves(
    points: CurvePoint[],
    morphT: number,
    morphFrom?: CurvePoint[],
  ): void {
    this.addCurvePolyline(
      points,
      (p) => new THREE.Vector3(p.x, p.y, 0.03),
      false,
      MANIM_GOLD,
    );

    this.addCurvePolyline(
      points,
      (p, i) => {
        const wx = morphFrom
          ? lerp(morphFrom[i].wx, p.wx, morphT)
          : lerp(p.x, p.wx, morphT);
        const wy = morphFrom
          ? lerp(morphFrom[i].wy, p.wy, morphT)
          : lerp(p.y, p.wy, morphT);
        if (!isWPlotable({ ...p, wx, wy })) return null;
        return new THREE.Vector3(wx, wy, 0.04);
      },
      true,
      MANIM_BLUE,
    );
  }

  private addCurvePolyline(
    points: CurvePoint[],
    map: (p: CurvePoint, i: number) => THREE.Vector3 | null,
    respectBreaks: boolean,
    color: number,
  ): void {
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
    let seg: THREE.Vector3[] = [];

    const flush = () => {
      if (seg.length > 1) {
        this.overlayGroup.add(
          new THREE.Line(new THREE.BufferGeometry().setFromPoints([...seg]), mat.clone()),
        );
      }
      seg = [];
    };

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const v = map(p, i);
      if (!v) {
        if (respectBreaks) flush();
        continue;
      }
      seg.push(v);
      if (respectBreaks && p.breakAfter) flush();
    }
    flush();
  }

  updateIsolines(segments: IsolineSegment[]): void {
    this.clearGroup(this.overlayGroup);
    const reMat = new THREE.LineBasicMaterial({ color: MANIM_BLUE, transparent: true, opacity: 0.7 });
    const imMat = new THREE.LineBasicMaterial({ color: MANIM_GOLD, transparent: true, opacity: 0.55 });
    for (const s of segments) {
      const mat = s.kind === "re" ? reMat : imMat;
      this.overlayGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(s.x1, s.y1, 0.03),
            new THREE.Vector3(s.x2, s.y2, 0.03),
          ]),
          mat,
        ),
      );
    }
  }

  updateCurves(
    zPts: { x: number; y: number }[],
    wPts: { x: number; y: number }[],
    showZ: boolean,
    showW: boolean,
  ): void {
    this.clearGroup(this.overlayGroup);
    if (showZ && zPts.length > 1) {
      this.overlayGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(zPts.map((p) => new THREE.Vector3(p.x, p.y, 0.04))),
          new THREE.LineBasicMaterial({ color: MANIM_GOLD }),
        ),
      );
    }
    if (showW && wPts.length > 1) {
      this.overlayGroup.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(wPts.map((p) => new THREE.Vector3(p.x, p.y, 0.05))),
          new THREE.LineBasicMaterial({ color: 0xfc6255 }),
        ),
      );
    }
  }

  private clearGroup(g: THREE.Group): void {
    while (g.children.length) {
      const ch = g.children[0];
      g.remove(ch);
      if (ch instanceof THREE.Line || ch instanceof THREE.Mesh || ch instanceof THREE.LineSegments) {
        ch.geometry.dispose();
        const m = ch.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    }
  }

  render(): void {
    this.orbitCtrl.update();
    this.renderer.render(this.scene, this.activeCamera());
    this.drawAxisOverlay();
  }

  exportPng(): string {
    this.render();
    const out = document.createElement("canvas");
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const ctx = out.getContext("2d");
    if (!ctx) return this.canvas.toDataURL("image/png");
    ctx.drawImage(this.canvas, 0, 0);
    if (this.viewMode !== "phase") {
      ctx.drawImage(this.axisOverlay.canvas, 0, 0);
    }
    return out.toDataURL("image/png");
  }

  mathToScreen(re: number, im: number): { x: number; y: number } {
    const lx = (2 * (re - this.region.xMin)) / (this.region.xMax - this.region.xMin) - 1;
    const ly = (2 * (im - this.region.yMin)) / (this.region.yMax - this.region.yMin) - 1;
    const gx = this.basePos.x + lx * this.baseScale.x;
    const gy = this.basePos.y + ly * this.baseScale.y;
    const s = this.cameraCtrl.state;
    const wx = s.panX + gx * s.zoom;
    const wy = s.panY + gy * s.zoom;
    const ndcX = wx / this.aspect;
    const ndcY = wy;
    return {
      x: ((ndcX + 1) / 2) * this.canvasW,
      y: ((1 - ndcY) / 2) * this.canvasH,
    };
  }

  private visibleMathBounds(): { xMin: number; xMax: number; yMin: number; yMax: number } {
    const pts = [
      this.worldFromScreen(0, 0),
      this.worldFromScreen(this.canvasW, 0),
      this.worldFromScreen(0, this.canvasH),
      this.worldFromScreen(this.canvasW, this.canvasH),
    ];
    return {
      xMin: Math.min(...pts.map((p) => p.x)),
      xMax: Math.max(...pts.map((p) => p.x)),
      yMin: Math.min(...pts.map((p) => p.y)),
      yMax: Math.max(...pts.map((p) => p.y)),
    };
  }

  private drawAxisOverlay(): void {
    this.axisOverlay.draw({
      width: this.canvasW,
      height: this.canvasH,
      region: this.region,
      visible: this.viewMode !== "phase",
      mathToScreen: (re, im) => this.mathToScreen(re, im),
      visibleBounds: () => this.visibleMathBounds(),
    });
  }

  worldFromScreen(sx: number, sy: number): { x: number; y: number } {
    if (this.viewMode === "phase") return { x: 0, y: 0 };
    const w = this.cameraCtrl.screenToWorld(sx, sy, this.aspect);
    const { xMin, xMax, yMin, yMax } = this.region;
    const lx = (w.x - this.basePos.x) / this.baseScale.x;
    const ly = (w.y - this.basePos.y) / this.baseScale.y;
    return {
      x: xMin + ((lx + 1) / 2) * (xMax - xMin),
      y: yMin + ((ly + 1) / 2) * (yMax - yMin),
    };
  }

  dispose(): void {
    this.axisOverlay.dispose();
    this.orbitCtrl.dispose();
    this.renderer.dispose();
    this.domainTex.dispose();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}