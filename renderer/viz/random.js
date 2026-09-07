'use strict';
import * as THREE from '../lib/three.module.js';
import { vertexShader, fragmentShader, getMorphState } from '../shaders/random.glsl.js';

const COUNT = 9000;

export class RandomViz {
  constructor(scene, freqTex) {
    this._scene = scene;
    this._startTime = null;
    this._lastTime = null;
    this._freqTex = freqTex;
    this._beatPulse = 0;
    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT * 4);

    for (let i = 0; i < COUNT; i++) {
      const index = i * 3;
      const seedIndex = i * 4;
      const longitude = Math.random() * Math.PI * 2;
      const latitude = Math.acos(1 - Math.random() * 2);
      const radius = (0.35 + Math.pow(Math.random(), 0.72) * 4.7);
      positions[index] = Math.sin(latitude) * Math.cos(longitude) * radius;
      positions[index + 1] = Math.cos(latitude) * radius * 0.9;
      positions[index + 2] = Math.sin(latitude) * Math.sin(longitude) * radius * 0.82;
      seeds[seedIndex] = Math.random();
      seeds[seedIndex + 1] = Math.random();
      seeds[seedIndex + 2] = Math.random();
      seeds[seedIndex + 3] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

    this._material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uFreqTex: { value: freqTex },
        uTime: { value: 0 },
        uShape: { value: 0 },
        uNextShape: { value: 1 },
        uMorph: { value: 0 },
        uEnergy: { value: 0 },
        uBeat: { value: 0 },
        uBass: { value: 0 },
        uMids: { value: 0 },
        uTreble: { value: 0 },
        uColorA: { value: new THREE.Color() },
        uColorB: { value: new THREE.Color() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this._points = new THREE.Points(geometry, this._material);
    this._points.frustumCulled = false;
    scene.add(this._points);
  }

  setTheme(colorA, colorB) {
    this._material.uniforms.uColorA.value.setRGB(...colorA);
    this._material.uniforms.uColorB.value.setRGB(...colorB);
  }

  update(time, energy, beat) {
    if (this._startTime === null) this._startTime = time;
    const elapsed = Math.max(0, time - this._startTime);
    const state = getMorphState(elapsed);
    const dt = this._lastTime === null ? 1 / 60 : Math.max(0, time - this._lastTime);
    this._lastTime = time;
    const uniforms = this._material.uniforms;
    const data = this._freqTex.image.data;
    // The shared texture contains 256 linear-frequency bins, packed as RGBA.
    const band = (first, end, gain) => {
      let sum = 0;
      for (let i = first; i < end; i++) sum += data[i * 4] / 255;
      return Math.min(1, sum / (end - first) * gain);
    };
    const follow = (name, target) => {
      const current = uniforms[name].value;
      const rate = target > current ? 24 : 7;
      uniforms[name].value += (target - current) * (1 - Math.exp(-dt * rate));
    };
    follow('uBass', band(0, 3, 1.35));
    follow('uMids', band(3, 32, 1.6));
    follow('uTreble', band(32, 128, 2.2));
    follow('uEnergy', Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0);
    this._beatPulse *= Math.exp(-dt * 8);
    if (beat) this._beatPulse = 1;
    this._material.uniforms.uShape.value = state.current;
    this._material.uniforms.uNextShape.value = state.next;
    this._material.uniforms.uMorph.value = state.blend;
    this._material.uniforms.uTime.value = elapsed;
    uniforms.uBeat.value = this._beatPulse;
    this._points.rotation.z = time * 0.08;
  }

  dispose() {
    this._scene.remove(this._points);
    this._points.geometry.dispose();
    this._material.dispose();
  }
}
