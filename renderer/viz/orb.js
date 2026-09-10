'use strict';
import * as THREE from '../lib/three.module.js';
import { vertexShader, fragmentShader } from '../shaders/orb.glsl.js';

const BINS = 128;

export class OrbViz {
  constructor(scene, freqTex) {
    this._scene = scene;
    this._freqTex = freqTex;
    this._lastTime = null;
    this._startTime = null;
    this._levels = new Float32Array(BINS);
    this._pixels = new Uint8Array(BINS * 4);
    this._spectrum = new THREE.DataTexture(this._pixels, BINS, 1, THREE.RGBAFormat);
    this._spectrum.needsUpdate = true;
    this._mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uSpectrum: { value: this._spectrum },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uEnergy: { value: 0 },
        uBeat: { value: 0 },
        uColorA: { value: new THREE.Color() },
        uColorB: { value: new THREE.Color() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      extensions: { derivatives: true },
    });
    // Billboard projection in the shader keeps the ring circular at any camera angle.
    this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), this._mat);
    this._mesh.frustumCulled = false;
    scene.add(this._mesh);
  }

  setTheme(colorA, colorB) {
    this._mat.uniforms.uColorA.value.setRGB(...colorA);
    this._mat.uniforms.uColorB.value.setRGB(...colorB);
  }

  update(time, energy, beat, details = {}) {
    const dt = this._lastTime === null ? 1 / 60 : Math.max(0, time - this._lastTime);
    this._lastTime = time;
    if (this._startTime === null) this._startTime = time;
    this._mat.uniforms.uTime.value = Math.max(0, time - this._startTime);
    const data = this._freqTex.image.data;
    for (let i = 0; i < BINS; i++) {
      const target = data[i * 4] / 255;
      const rate = target > this._levels[i] ? 28 : 8;
      this._levels[i] += (target - this._levels[i]) * (1 - Math.exp(-dt * rate));
      const offset = i * 4;
      this._pixels[offset] = Math.round(this._levels[i] * 255);
      this._pixels[offset + 3] = 255;
    }
    this._spectrum.needsUpdate = true;
    const u = this._mat.uniforms;
    u.uBass.value = (this._levels[0] + this._levels[1] + this._levels[2]) / 3;
    const safeEnergy = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0;
    u.uEnergy.value += (safeEnergy - u.uEnergy.value) * (1 - Math.exp(-dt * 10));
    u.uBeat.value *= Math.exp(-dt * 9);
    if (beat) u.uBeat.value = 1;
    const phase = details?.phase ?? 0;
    const preBeat = Math.pow(Math.max(0, phase - 0.82) / 0.18, 2) * 0.28;
    u.uBeat.value = Math.max(u.uBeat.value, preBeat);
  }

  dispose() {
    this._scene.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mat.dispose();
    this._spectrum.dispose();
  }
}
