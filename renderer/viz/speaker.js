'use strict';
import * as THREE from '../lib/three.module.js';
import {
  WH,
  tubeVertexShader, tubeFragmentShader,
  dustVertexShader, dustFragmentShader,
  ringVertexShader, ringFragmentShader,
  coreVertexShader, coreFragmentShader,
  starVertexShader, starFragmentShader,
} from '../shaders/speaker.glsl.js';

const SEG_U = 168;   // points around the tube
const SEG_V = 220;   // rings along the tube
const DUST_COUNT = 1900;
const STAR_COUNT = 850;

export class SpeakerViz {
  constructor(scene, freqTex) {
    this._scene      = scene;
    this._motionTime = 0;
    this._lastTime   = 0;
    this._speedEnergy = 0;

    this._colorA = new THREE.Color(0.15, 0.8, 1.0);
    this._colorB = new THREE.Color(0.7, 0.1, 1.0);

    this._buildTube(freqTex);
    this._buildDust();
    this._buildRing();
    this._buildStars();
    this._buildCore();

    this._group = new THREE.Group();
    this._group.add(this._tube, this._dust, this._ring, this._stars, this._core);
    scene.add(this._group);
  }

  // ── Wormhole wall ────────────────────────────────────────────────
  _buildTube(freqTex) {
    const verts   = SEG_U * SEG_V;
    const angles  = new Float32Array(verts);
    const depths  = new Float32Array(verts);
    const dummyP  = new Float32Array(verts * 3);   // real positions come from the shader

    for (let v = 0; v < SEG_V; v++) {
      for (let u = 0; u < SEG_U; u++) {
        const i = v * SEG_U + u;
        angles[i] = u / SEG_U;
        depths[i] = v / (SEG_V - 1);
      }
    }

    const indices = [];
    for (let v = 0; v < SEG_V - 1; v++) {
      for (let u = 0; u < SEG_U; u++) {
        const a = v * SEG_U + u;
        const b = v * SEG_U + ((u + 1) % SEG_U);
        const c = (v + 1) * SEG_U + u;
        const d = (v + 1) * SEG_U + ((u + 1) % SEG_U);
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(dummyP, 3));
    geo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
    geo.setIndex(indices);

    this._tubeMat = new THREE.ShaderMaterial({
      vertexShader: tubeVertexShader,
      fragmentShader: tubeFragmentShader,
      uniforms: {
        uFreqTex: { value: freqTex },
        uTime:    { value: 0 },
        uTravel:  { value: 0 },
        uEnergy:  { value: 0 },
        uBeat:    { value: 0 },
        uColorA:  { value: this._colorA.clone() },
        uColorB:  { value: this._colorB.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthTest: false,
      toneMapped: false,
    });

    this._tube = new THREE.Mesh(geo, this._tubeMat);
    this._tube.renderOrder = -1;
    this._tube.frustumCulled = false;
  }

  // ── Infalling matter ────────────────────────────────────────────
  _buildDust() {
    const seed    = new Float32Array(DUST_COUNT);
    const arm     = new Float32Array(DUST_COUNT);
    const scatter = new Float32Array(DUST_COUNT);
    const ARMS = 3;
    for (let i = 0; i < DUST_COUNT; i++) {
      seed[i]    = Math.random();
      arm[i]     = (i % ARMS) / ARMS + Math.random() * 0.03;
      scatter[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_COUNT * 3), 3));
    geo.setAttribute('aSeed',    new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aArm',     new THREE.BufferAttribute(arm, 1));
    geo.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 1));

    this._dustMat = new THREE.ShaderMaterial({
      vertexShader: dustVertexShader,
      fragmentShader: dustFragmentShader,
      uniforms: {
        uTime:   { value: 0 },
        uEnergy: { value: 0 },
        uBeat:   { value: 0 },
        uColorA: { value: this._colorA.clone() },
        uColorB: { value: this._colorB.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    this._dust = new THREE.Points(geo, this._dustMat);
    this._dust.frustumCulled = false;
  }

  // ── Einstein ring at the throat ─────────────────────────────────
  _buildRing() {
    const inner = WH.THROAT_R * 0.25;
    const outer = WH.THROAT_R * 3.4;
    const geo = new THREE.RingGeometry(inner, outer, 160, 1);

    this._ringMat = new THREE.ShaderMaterial({
      vertexShader: ringVertexShader,
      fragmentShader: ringFragmentShader,
      uniforms: {
        uInner:  { value: inner },
        uOuter:  { value: outer },
        uTime:   { value: 0 },
        uEnergy: { value: 0 },
        uBeat:   { value: 0 },
        uColorA: { value: this._colorA.clone() },
        uColorB: { value: this._colorB.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this._ring = new THREE.Mesh(geo, this._ringMat);
    this._ring.position.z = WH.THROAT_Z + 0.4;
    this._ring.frustumCulled = false;
  }

  // ── Far-side starfield ─────────────────────────────────────────
  _buildStars() {
    const pos     = new Float32Array(STAR_COUNT * 3);
    const twinkle = new Float32Array(STAR_COUNT);
    const zBase   = -WH.TUBE_LEN + 2.0;
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = Math.sqrt(Math.random()) * WH.MAX_R * 0.95;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3]     = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.sin(a) * r;
      pos[i * 3 + 2] = zBase - Math.random() * 6.0;
      twinkle[i]     = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',  new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aTwinkle',  new THREE.BufferAttribute(twinkle, 1));

    this._starMat = new THREE.ShaderMaterial({
      vertexShader: starVertexShader,
      fragmentShader: starFragmentShader,
      uniforms: {
        uTime:   { value: 0 },
        uEnergy: { value: 0 },
        uColorB: { value: this._colorB.clone() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    this._stars = new THREE.Points(geo, this._starMat);
    this._stars.frustumCulled = false;
  }

  // ── White-hot singularity glow at the throat ────────────────────
  _buildCore() {
    this._core = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 3.6),
      new THREE.ShaderMaterial({
        vertexShader: coreVertexShader,
        fragmentShader: coreFragmentShader,
        uniforms: {
          uTime:   { value: 0 },
          uEnergy: { value: 0 },
          uBeat:   { value: 0 },
          uColorB: { value: this._colorB.clone() },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    );
    this._core.position.set(0, 0, WH.THROAT_Z + 1.4);
    this._core.frustumCulled = false;
    this._core.renderOrder = 2;
  }

  // ── Public API ─────────────────────────────────────────────────
  setTheme(colorA, colorB) {
    this._colorA.setRGB(...colorA);
    this._colorB.setRGB(...colorB);
    this._tubeMat.uniforms.uColorA.value.copy(this._colorA);
    this._tubeMat.uniforms.uColorB.value.copy(this._colorB);
    this._dustMat.uniforms.uColorA.value.copy(this._colorA);
    this._dustMat.uniforms.uColorB.value.copy(this._colorB);
    this._ringMat.uniforms.uColorA.value.copy(this._colorA);
    this._ringMat.uniforms.uColorB.value.copy(this._colorB);
    this._starMat.uniforms.uColorB.value.copy(this._colorB);
    this._core.material.uniforms.uColorB.value.copy(this._colorB);
  }

  update(time, energy, beat) {
    const delta = this._lastTime ? Math.min(time - this._lastTime, 0.05) : 0.016;
    this._lastTime = time;

    const playing = beat || energy > 0.01;
    this._speedEnergy += (energy - this._speedEnergy) * Math.min(delta * 5.0, 1.0);

    const animSpeed   = playing ? 0.8 + this._speedEnergy * 1.1 : 0.12;
    const travelSpeed = playing ? 0.7 + this._speedEnergy * 2.4 : 0.08;
    this._motionTime += delta * animSpeed;
    const travel = (this._tubeMat.uniforms.uTravel.value += delta * travelSpeed);
    const b = beat ? 1.0 : 0.0;

    for (const m of [this._tubeMat, this._dustMat, this._ringMat, this._starMat]) {
      if (m.uniforms.uTime)   m.uniforms.uTime.value   = this._motionTime;
      if (m.uniforms.uEnergy) m.uniforms.uEnergy.value = energy;
      if (m.uniforms.uBeat)   m.uniforms.uBeat.value   = b;
    }
    this._dustMat.uniforms.uTime.value = travel;   // dust rides the travel clock

    // Swirl the far side — a nod to gravitational lensing.
    this._stars.rotation.z += delta * (0.06 + this._speedEnergy * 0.4);

    const pulse = 1.0 + this._speedEnergy * 0.45 + (beat ? 0.14 : 0);
    this._core.scale.setScalar(pulse);
    this._core.material.uniforms.uTime.value   = this._motionTime;
    this._core.material.uniforms.uEnergy.value = energy;
    this._core.material.uniforms.uBeat.value   = b;
  }

  dispose() {
    this._scene.remove(this._group);
    for (const o of [this._tube, this._dust, this._ring, this._stars, this._core]) {
      o.geometry.dispose();
      o.material.dispose();
    }
  }
}
