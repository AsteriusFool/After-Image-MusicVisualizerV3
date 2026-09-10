'use strict';
import * as THREE from '../lib/three.module.js';
import { vertexShader, fragmentShader } from '../shaders/impulse.glsl.js';

const COUNT = 90;
const SPRING = 7.5;
const DAMP = 4.5;
const ANGULAR_DAMP = 1.6;
const MAX_RADIUS = 4.6;  // hard containment so rapid kicks can't out-accumulate the spring and drift offscreen
const MAX_SPEED = 8;

/**
 * Bass-impulse physics field.
 * A cloud of faceted shards sits on a resting shell around the origin. Every
 * kick onset (details.kick crossing above 0.5) fires a radial + upward impulse
 * into each shard's velocity; a spring pulls it back toward its resting
 * position between hits, so bass literally "punches" the scene instead of
 * only scaling geometry.
 */
export class ImpulseViz {
  constructor(scene, freqTex) {
    this._scene = scene;
    this._lastTime = null;
    this._prevKick = 0;

    const geo = new THREE.IcosahedronGeometry(0.16, 0);
    const mixAttr = new Float32Array(COUNT);
    geo.setAttribute('aColorMix', new THREE.InstancedBufferAttribute(mixAttr, 1));

    this._mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColorA: { value: new THREE.Color() },
        uColorB: { value: new THREE.Color() },
        uGlow: { value: 0.4 },
      },
      depthWrite: true,
      transparent: false,
    });

    this._mesh = new THREE.InstancedMesh(geo, this._mat, COUNT);
    this._mesh.frustumCulled = false;
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this._home = [];
    this._pos = [];
    this._vel = [];
    this._rot = [];
    this._angVel = [];
    this._scratchDir = new THREE.Vector3();
    this._scratchToHome = new THREE.Vector3();
    this._dummy = new THREE.Object3D();

    for (let i = 0; i < COUNT; i++) {
      const radius = 1.4 + Math.random() * 2.6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.lerp(-1, 1, Math.random()));
      const home = new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi) * 0.6 + 0.5,
        radius * Math.sin(phi) * Math.sin(theta),
      );
      this._home.push(home);
      this._pos.push(home.clone());
      this._vel.push(new THREE.Vector3());
      this._rot.push(new THREE.Vector3(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
      this._angVel.push(new THREE.Vector3());
      mixAttr[i] = Math.random();

      this._dummy.position.copy(home);
      this._dummy.updateMatrix();
      this._mesh.setMatrixAt(i, this._dummy.matrix);
    }
    geo.attributes.aColorMix.needsUpdate = true;
    this._mesh.instanceMatrix.needsUpdate = true;
    this._scene.add(this._mesh);
  }

  setTheme(colorA, colorB) {
    this._mat.uniforms.uColorA.value.setRGB(...colorA);
    this._mat.uniforms.uColorB.value.setRGB(...colorB);
  }

  update(time, energy, beat, details = {}) {
    const dt = this._lastTime === null ? 1 / 60 : Math.max(0.0005, Math.min(0.05, time - this._lastTime));
    this._lastTime = time;

    const kick = details.kick ?? (beat ? 0.8 : 0);
    const kickHit = kick > 0.5 && this._prevKick <= 0.5;
    this._prevKick = kick;

    const safeEnergy = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0;
    this._mat.uniforms.uGlow.value += ((0.3 + kick * 0.9 + safeEnergy * 0.3) - this._mat.uniforms.uGlow.value) * (1 - Math.exp(-dt * 10));

    for (let i = 0; i < COUNT; i++) {
      const home = this._home[i];
      const pos = this._pos[i];
      const vel = this._vel[i];

      if (kickHit) {
        this._scratchDir.copy(pos);
        if (this._scratchDir.lengthSq() < 1e-6) this._scratchDir.set(0, 1, 0);
        else this._scratchDir.normalize();
        const strength = 1.6 + kick * 2.6;
        vel.addScaledVector(this._scratchDir, strength * (0.6 + Math.random() * 0.8));
        vel.y += strength * 0.4;
        this._angVel[i].set(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
        );
      }

      // Spring back toward the resting shell, damped so it settles rather than oscillates forever.
      this._scratchToHome.copy(home).sub(pos);
      vel.addScaledVector(this._scratchToHome, SPRING * dt);
      vel.multiplyScalar(Math.max(0, 1 - DAMP * dt));

      const speedSq = vel.lengthSq();
      if (speedSq > MAX_SPEED * MAX_SPEED) vel.multiplyScalar(MAX_SPEED / Math.sqrt(speedSq));

      pos.addScaledVector(vel, dt);

      // Hard containment: a burst of fast kicks can otherwise out-accumulate the spring
      // faster than it can pull back, letting a shard drift past the camera frustum.
      const distSq = pos.lengthSq();
      if (distSq > MAX_RADIUS * MAX_RADIUS) {
        const dist = Math.sqrt(distSq);
        this._scratchDir.copy(pos).multiplyScalar(1 / dist);
        pos.copy(this._scratchDir).multiplyScalar(MAX_RADIUS);
        const outward = vel.dot(this._scratchDir);
        if (outward > 0) vel.addScaledVector(this._scratchDir, -outward);
      }

      const rot = this._rot[i];
      const angVel = this._angVel[i];
      rot.addScaledVector(angVel, dt);
      angVel.multiplyScalar(Math.max(0, 1 - ANGULAR_DAMP * dt));

      this._dummy.position.copy(pos);
      this._dummy.rotation.set(rot.x, rot.y, rot.z);
      const s = 0.8 + safeEnergy * 0.35 + kick * 0.3;
      this._dummy.scale.setScalar(s);
      this._dummy.updateMatrix();
      this._mesh.setMatrixAt(i, this._dummy.matrix);
    }
    this._mesh.instanceMatrix.needsUpdate = true;
    this._mesh.rotation.y = time * 0.05;
  }

  dispose() {
    this._scene.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mat.dispose();
  }
}
