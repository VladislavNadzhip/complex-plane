import gsap from "gsap";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MANIM_EASE_NAMES } from "../core/manimEase";

const HOME = new THREE.Vector3(2.2, 2.0, 2.8);

export class OrbitController {
  private controls: OrbitControls;
  private resetTween: gsap.core.Tween | null = null;
  enabled = false;

  constructor(
    private camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
  ) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.85;
    this.controls.zoomSpeed = 1.1;
    this.controls.panSpeed = 0.6;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 12;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.enabled = false;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.controls.enabled = on;
  }

  reset(): void {
    this.resetTween?.kill();
    const from = this.camera.position.clone();
    const proxy = { t: 0 };
    this.controls.target.set(0, 0, 0);
    this.resetTween = gsap.to(proxy, {
      t: 1,
      duration: 0.7,
      ease: MANIM_EASE_NAMES.smooth,
      onUpdate: () => {
        this.camera.position.lerpVectors(from, HOME, proxy.t);
        this.camera.lookAt(0, 0, 0);
      },
      onComplete: () => (this.resetTween = null),
    });
  }

  update(): void {
    if (this.enabled) this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}