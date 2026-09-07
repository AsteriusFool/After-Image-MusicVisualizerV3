'use strict';
import * as THREE from '../lib/three.module.js';
import { vertexShader, fragmentShader } from '../shaders/bars.glsl.js';

const BAR_COUNT = 72;
const INNER_R = 2.4;
const MAX_H = 3.2;

export class BarsViz {
  constructor(scene, freqTex) {
    this._scene = scene;
    this._freqTex = freqTex;
    this._lastTime = null;
    this._beat = 0;
    this._energy = 0;
    this._group = new THREE.Group();
    this._group.position.y = -0.25;

    // Narrow tangential faces leave a visible gap between neighbouring bars.
    const geo = new THREE.BoxGeometry(0.18, 1, 0.13);
    geo.translate(0, 0.5, 0);
    const phases = new Float32Array(BAR_COUNT);
    this._levels = new Float32Array(BAR_COUNT);
    this._bands = [];
    // Whole-bin boundaries keep neighbouring bars on distinct frequency ranges.
    const bandCount = BAR_COUNT / 2;
    const bandEdge = index => Math.floor(index + (128 - bandCount) * (index / bandCount) ** 2);
    for (let i = 0; i < BAR_COUNT; i++) {
      // Mirror the spectrum across the two halves, with bass at both ends.
      const band = Math.min(i, BAR_COUNT - 1 - i);
      const phase = band / (BAR_COUNT / 2 - 1);
      phases[i] = phase;
      // Narrow low-frequency ranges gradually widen toward the highs.
      const start = bandEdge(band);
      const end = bandEdge(band + 1);
      this._bands.push({ start, end });
    }
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    this._levelAttribute = new THREE.InstancedBufferAttribute(this._levels, 1);
    this._levelAttribute.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aLevel', this._levelAttribute);

    this._mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uMaxH: { value: MAX_H },
        uBeat: { value: 0 },
        uColorA: { value: new THREE.Color() },
        uColorB: { value: new THREE.Color() },
      },
      // Solid faces preserve the front/back separation as the ring rotates.
      depthWrite: true,
      transparent: false,
    });
    this._mesh = new THREE.InstancedMesh(geo, this._mat, BAR_COUNT);
    this._mesh.frustumCulled = false; // Heights are changed by the vertex shader.
    this._mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < BAR_COUNT; i++) {
      const angle = i / BAR_COUNT * Math.PI * 2;
      dummy.position.set(Math.cos(angle) * INNER_R, 0, Math.sin(angle) * INNER_R);
      dummy.rotation.y = -angle;
      dummy.updateMatrix();
      this._mesh.setMatrixAt(i, dummy.matrix);
    }
    this._mesh.instanceMatrix.needsUpdate = true;
    this._group.add(this._mesh);

    this._rim = new THREE.Mesh(
      new THREE.TorusGeometry(INNER_R, 0.018, 6, 144),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this._rim.rotation.x = Math.PI / 2;
    this._rim.position.y = -0.035;
    this._group.add(this._rim);
    scene.add(this._group);
  }

  setTheme(colorA, colorB) {
    this._mat.uniforms.uColorA.value.setRGB(...colorA);
    this._mat.uniforms.uColorB.value.setRGB(...colorB);
    this._rim.material.color.setRGB(...colorA).lerp(this._mat.uniforms.uColorB.value, 0.5).multiplyScalar(0.38);
  }

  update(time, energy, beat) {
    const dt = this._lastTime === null ? 1 / 60 : Math.max(0, time - this._lastTime);
    this._lastTime = time;
    const data = this._freqTex.image.data;
    for (let i = 0; i < BAR_COUNT; i++) {
      const { start, end } = this._bands[i];
      let sum = 0;
      // Fractional overlap averages each frequency interval without skipping bins.
      for (let bin = Math.floor(start); bin < Math.ceil(end); bin++) {
        const weight = Math.max(0, Math.min(end, bin + 1) - Math.max(start, bin));
        sum += (data[Math.min(bin, 255) * 4] / 255) * weight;
      }
      const target = Math.pow(Math.min(1, Math.max(0, sum / (end - start))), 0.85);
      const rate = target > this._levels[i] ? 22 : 6;
      this._levels[i] += (target - this._levels[i]) * (1 - Math.exp(-dt * rate));
    }
    this._levelAttribute.needsUpdate = true;
    this._beat *= Math.exp(-dt * 8);
    if (beat) this._beat = 1;
    this._mat.uniforms.uBeat.value = this._beat;
    const safeEnergy = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0;
    this._energy += (safeEnergy - this._energy) * (1 - Math.exp(-dt * 4));
    // Integrating rotation prevents jumps when the music intensity changes.
    this._group.rotation.y = (this._group.rotation.y + Math.min(dt, 0.1) * (0.22 + this._energy * 0.1)) % (Math.PI * 2);
  }

  dispose() {
    this._scene.remove(this._group);
    this._mesh.geometry.dispose();
    this._mat.dispose();
    this._rim.geometry.dispose();
    this._rim.material.dispose();
  }
}
