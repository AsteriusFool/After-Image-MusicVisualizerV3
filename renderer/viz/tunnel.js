'use strict';
import * as THREE from '../lib/three.module.js';
import { vertexShader, fragmentShader } from '../shaders/tunnel.glsl.js';

const RINGS = 150;
const POINTS_PER_RING = 96;
const COUNT = RINGS * POINTS_PER_RING;
const RING_SPACING = 0.13;

export class TunnelViz {
  constructor(scene, freqTex) {
    this._scene = scene;

    const positions = new Float32Array(COUNT * 3);
    const freqIndices = new Float32Array(COUNT);
    const ringIndices = new Float32Array(COUNT);

    for (let ring = 0; ring < RINGS; ring++) {
      const z = 3.2 - ring * RING_SPACING;
      const ringRadius = 0.18 + ring * 0.032;
      for (let point = 0; point < POINTS_PER_RING; point++) {
        const index = ring * POINTS_PER_RING + point;
        const angle = (point / POINTS_PER_RING) * Math.PI * 2;
        const offset = (ring % 2) * 0.025;
        positions[index * 3] = Math.cos(angle + offset) * ringRadius;
        positions[index * 3 + 1] = Math.sin(angle + offset) * ringRadius;
        positions[index * 3 + 2] = z;
        freqIndices[index] = point / POINTS_PER_RING;
        ringIndices[index] = ring / (RINGS - 1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aFreqIndex', new THREE.BufferAttribute(freqIndices, 1));
    geo.setAttribute('aRingIndex', new THREE.BufferAttribute(ringIndices, 1));

    this._mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uFreqTex: { value: freqTex },
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uBeat: { value: 0 },
        uColorA: { value: new THREE.Color() },
        uColorB: { value: new THREE.Color() },
      },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });

    this._points = new THREE.Points(geo, this._mat);
    this._points.frustumCulled = false;
    this._points.rotation.x = -0.08;
    scene.add(this._points);
  }

  setTheme(colorA, colorB) {
    this._mat.uniforms.uColorA.value.setRGB(...colorA);
    this._mat.uniforms.uColorB.value.setRGB(...colorB);
  }

  update(time, energy, beat, details = {}) {
    this._mat.uniforms.uTime.value = time;
    this._mat.uniforms.uEnergy.value = energy;
    const phase = details?.phase ?? 0;
    const preBeat = Math.pow(Math.max(0, phase - 0.82) / 0.18, 2) * 0.3;
    this._mat.uniforms.uBeat.value = beat ? 1.0 : preBeat;
    this._points.rotation.z = time * 0.035;
  }

  dispose() {
    this._scene.remove(this._points);
    this._points.geometry.dispose();
    this._mat.dispose();
  }
}
