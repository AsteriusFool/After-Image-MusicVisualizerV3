'use strict';
import * as THREE from '../lib/three.module.js';
import { vertexShader, fragmentShader } from '../shaders/particles.glsl.js';

const COUNT    = 8000;
const MAJOR_R  = 2.7;   // torus major radius
const MINOR_R  = 0.9;   // torus minor radius

export class ParticlesViz {
  constructor(scene, freqTex) {
    this._scene = scene;

    const positions  = new Float32Array(COUNT * 3);
    const freqIdx    = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * Math.PI * 2;
      const r = MAJOR_R + MINOR_R * Math.cos(v);

      positions[i * 3]     = r * Math.cos(u);
      positions[i * 3 + 1] = MINOR_R * Math.sin(v);
      positions[i * 3 + 2] = r * Math.sin(u);

      freqIdx[i] = i / COUNT;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aBasePos',   new THREE.BufferAttribute(positions.slice(), 3));
    geo.setAttribute('aFreqIndex', new THREE.BufferAttribute(freqIdx, 1));

    this._mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uFreqTex:  { value: freqTex },
        uTime:     { value: 0 },
        uEnergy:   { value: 0 },
        uBeat:     { value: 0 },
        uColorA:   { value: new THREE.Color() },
        uColorB:   { value: new THREE.Color() },
      },
      blending:     THREE.AdditiveBlending,
      depthWrite:   false,
      transparent:  true,
    });

    this._points = new THREE.Points(geo, this._mat);
    this._points.frustumCulled = false; // particles pulse outward beyond initial bounding sphere
    scene.add(this._points);
  }

  setTheme(colorA, colorB) {
    this._mat.uniforms.uColorA.value.setRGB(...colorA);
    this._mat.uniforms.uColorB.value.setRGB(...colorB);
  }

  update(time, energy, beat, details = {}) {
    this._mat.uniforms.uTime.value    = time;
    this._mat.uniforms.uEnergy.value  = energy;
    // Reactive spike on the detected beat; a small phase-predicted pre-swell otherwise.
    const phase = details?.phase ?? 0;
    const preBeat = Math.pow(Math.max(0, phase - 0.82) / 0.18, 2) * 0.3;
    this._mat.uniforms.uBeat.value    = beat ? 1.0 : preBeat;
    this._points.rotation.y           = time * 0.07;
  }

  dispose() {
    this._scene.remove(this._points);
    this._points.geometry.dispose();
    this._mat.dispose();
  }
}
