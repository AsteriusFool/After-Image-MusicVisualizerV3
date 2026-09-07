'use strict';
import * as THREE from '../lib/three.module.js';
import { Exc3Typography } from '../exc3-typography.js';
import {
  shardVertexShader, shardFragmentShader,
  ribbonVertexShader, ribbonFragmentShader,
  hudVertexShader, hudFragmentShader,
} from '../shaders/exc3.glsl.js';

const SHARD_COUNT = 128;

const CAMERA_PRESETS = [
  { pos: new THREE.Vector3(0.0, 0.8, 6.2), look: new THREE.Vector3(0, 0, 0) },   // Frontal wide
  { pos: new THREE.Vector3(2.4, -1.1, 4.5), look: new THREE.Vector3(0, 0.2, 0) }, // Low Dutch angle
  { pos: new THREE.Vector3(0.1, 7.6, 0.2), look: new THREE.Vector3(0, 0, 0) },   // Overhead tactical
  { pos: new THREE.Vector3(-1.8, 0.7, 2.5), look: new THREE.Vector3(0.2, 0, 0) }, // Macro shard close-up
  { pos: new THREE.Vector3(5.0, 3.6, 4.8), look: new THREE.Vector3(0, 0, 0) },   // Side isometric
];

export class Exc3Viz {
  constructor(scene, freqTex) {
    this._scene = scene;
    this._freqTex = freqTex;
    this._group = new THREE.Group();

    this._lastTime = null;
    this._lastCutTime = 0;
    this._currentPreset = 0;

    // ── 1. Spring Physics Kinetic Camera State ─────────────────────
    this.cameraPos   = new THREE.Vector3().copy(CAMERA_PRESETS[0].pos);
    this.cameraVel   = new THREE.Vector3();
    this.targetPos   = new THREE.Vector3().copy(CAMERA_PRESETS[0].pos);
    this.cameraLook  = new THREE.Vector3().copy(CAMERA_PRESETS[0].look);
    this.targetLook  = new THREE.Vector3().copy(CAMERA_PRESETS[0].look);
    this.cameraFov   = 55;
    this.fovVel      = 0;
    this.targetFov   = 55;

    // ── 2. Procedural Geometric Shards ─────────────────────────────
    const shardGeo = new THREE.OctahedronGeometry(0.28, 0);
    const freqIndices = new Float32Array(SHARD_COUNT);
    this._shardMesh = new THREE.InstancedMesh(shardGeo, null, SHARD_COUNT);
    this._shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this._shardTransforms = [];
    const dummy = new THREE.Object3D();

    for (let i = 0; i < SHARD_COUNT; i++) {
      freqIndices[i] = i / SHARD_COUNT;

      // Distribute in a spherical cloud with organic clusters
      const phi = Math.acos(-1 + (2 * i) / SHARD_COUNT);
      const theta = Math.sqrt(SHARD_COUNT * Math.PI) * phi;
      const radius = 1.4 + Math.random() * 1.6;

      const x = Math.sin(phi) * Math.cos(theta) * radius;
      const y = Math.sin(phi) * Math.sin(theta) * radius;
      const z = Math.cos(phi) * radius;

      dummy.position.set(x, y, z);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      const scale = 0.6 + Math.random() * 0.9;
      dummy.scale.set(scale, scale, scale * 1.6);
      dummy.updateMatrix();

      this._shardMesh.setMatrixAt(i, dummy.matrix);
      this._shardTransforms.push({
        basePos: new THREE.Vector3(x, y, z),
        rotSpeed: new THREE.Vector3(
          (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 1.5
        ),
        scale,
      });
    }

    this._shardMesh.instanceMatrix.needsUpdate = true;
    this._shardMesh.frustumCulled = false;

    shardGeo.setAttribute('aFreqIdx', new THREE.InstancedBufferAttribute(freqIndices, 1));

    this._shardMat = new THREE.ShaderMaterial({
      vertexShader: shardVertexShader,
      fragmentShader: shardFragmentShader,
      uniforms: {
        uFreqTex: { value: freqTex },
        uTime:    { value: 0 },
        uKick:    { value: 0 },
        uSnare:   { value: 0 },
        uPhase:   { value: 0 },
        uEnergy:  { value: 0 },
        uColorA:  { value: new THREE.Color(1, 1, 1) },
        uColorB:  { value: new THREE.Color(0.2, 0.8, 1) },
      },
    });
    this._shardMesh.material = this._shardMat;
    this._group.add(this._shardMesh);

    // ── 3. Undulating Audio Ribbon Strip ───────────────────────────
    const ribbonGeo = new THREE.PlaneGeometry(14, 1.2, 128, 8);
    this._ribbonMat = new THREE.ShaderMaterial({
      vertexShader: ribbonVertexShader,
      fragmentShader: ribbonFragmentShader,
      uniforms: {
        uFreqTex: { value: freqTex },
        uTime:    { value: 0 },
        uKick:    { value: 0 },
        uPhase:   { value: 0 },
        uColorA:  { value: new THREE.Color(1, 1, 1) },
        uColorB:  { value: new THREE.Color(0.1, 0.9, 1) },
      },
      side: THREE.DoubleSide,
      transparent: true,
    });
    this._ribbon = new THREE.Mesh(ribbonGeo, this._ribbonMat);
    this._ribbon.position.y = -1.5;
    this._ribbon.rotation.x = -Math.PI * 0.35;
    this._group.add(this._ribbon);

    // ── 4. Technical Wireframe Bounding Cages ──────────────────────
    const cageGeo = new THREE.BoxGeometry(6.5, 6.5, 6.5);
    const wireGeo = new THREE.WireframeGeometry(cageGeo);
    this._wireMesh = new THREE.LineSegments(
      wireGeo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 })
    );
    this._group.add(this._wireMesh);

    // Floor grid
    this._grid = new THREE.GridHelper(18, 24, 0xffffff, 0x333333);
    this._grid.position.y = -2.8;
    this._group.add(this._grid);

    // ── 5. Technical Typography HUD Layer ──────────────────────────
    this._typography = new Exc3Typography(2048, 1024);
    const hudGeo = new THREE.PlaneGeometry(2, 2);
    this._hudMat = new THREE.ShaderMaterial({
      vertexShader: hudVertexShader,
      fragmentShader: hudFragmentShader,
      uniforms: {
        uHudTex: { value: this._typography.texture },
      },
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    this._hudMesh = new THREE.Mesh(hudGeo, this._hudMat);
    this._hudMesh.frustumCulled = false;

    // Dedicated HUD scene rendered into the same render target
    this.hudScene = new THREE.Scene();
    this.hudCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.hudCamera.position.z = 1;
    this.hudScene.add(this._hudMesh);

    this._themeColorA = [1, 1, 1];
    this._themeColorB = [0.2, 0.8, 1];

    scene.add(this._group);
  }

  setTheme(colorA, colorB) {
    this._themeColorA = colorA;
    this._themeColorB = colorB;
    this._shardMat.uniforms.uColorA.value.setRGB(...colorA);
    this._shardMat.uniforms.uColorB.value.setRGB(...colorB);
    this._ribbonMat.uniforms.uColorA.value.setRGB(...colorA);
    this._ribbonMat.uniforms.uColorB.value.setRGB(...colorB);
    this._wireMesh.material.color.setRGB(...colorB).multiplyScalar(0.7);
  }

  update(time, energy, beat, details = {}, camera = null) {
    const dt = this._lastTime === null ? 1 / 60 : Math.max(0.001, Math.min(0.1, time - this._lastTime));
    this._lastTime = time;

    const kick   = details.kick   ?? (beat ? 0.8 : 0);
    const snare  = details.snare  ?? 0;
    const hihat  = details.hihat  ?? 0;
    const phase  = details.phase  ?? 0;
    const resolvedEnergy = details.energy ?? energy;

    details.kick   = kick;
    details.snare  = snare;
    details.hihat  = hihat;
    details.phase  = phase;
    details.energy = resolvedEnergy;

    // ── 1. Update Shard & Ribbon Shader Uniforms ───────────────────
    this._shardMat.uniforms.uTime.value   = time;
    this._shardMat.uniforms.uKick.value   = kick;
    this._shardMat.uniforms.uSnare.value  = snare;
    this._shardMat.uniforms.uPhase.value  = phase;
    this._shardMat.uniforms.uEnergy.value = resolvedEnergy;

    this._ribbonMat.uniforms.uTime.value  = time;
    this._ribbonMat.uniforms.uKick.value  = kick;
    this._ribbonMat.uniforms.uPhase.value = phase;

    // Slow orbital tumbling of shard cluster
    this._group.rotation.y = time * 0.15 + phase * 0.3;
    this._group.rotation.x = Math.sin(time * 0.2) * 0.08;

    this._wireMesh.rotation.y = -time * 0.08;
    this._wireMesh.rotation.z = Math.cos(time * 0.1) * 0.05;
    this._wireMesh.material.opacity = 0.18 + kick * 0.25;

    // ── 2. Kinetic Spring Camera & Drop Jump Cuts ──────────────────
    // Punch FOV outward on kick onset with immediate snappy spring rebound
    if (kick > 0.45 && kick > (this._prevKick || 0)) {
      this.fovVel = Math.max(this.fovVel, (kick - 0.45) * 85.0);
    }
    this._prevKick = kick;

    // Spring physics on FOV (stiffness 240, damping 20)
    const fovDisplacement = this.cameraFov - this.targetFov;
    const fovSpringForce  = -240.0 * fovDisplacement - 20.0 * this.fovVel;
    this.fovVel += fovSpringForce * dt;
    this.cameraFov += this.fovVel * dt;
    this.cameraFov = Math.max(45, Math.min(85, this.cameraFov));

    // High-energy drop camera jump cuts
    if ((kick > 0.82 || (beat && energy > 0.65)) && (time - this._lastCutTime > 0.85)) {
      this._lastCutTime = time;
      this._currentPreset = (this._currentPreset + 1 + Math.floor(Math.random() * (CAMERA_PRESETS.length - 1))) % CAMERA_PRESETS.length;
      const nextPreset = CAMERA_PRESETS[this._currentPreset];
      this.targetPos.copy(nextPreset.pos);
      this.targetLook.copy(nextPreset.look);
      // Hard jump cut to simulate rapid motion-graphics editing
      this.cameraPos.copy(nextPreset.pos);
      this.cameraVel.set(0, 0, 0);
    } else {
      // Gentle spring tracking between camera moves
      const posDiff = new THREE.Vector3().subVectors(this.cameraPos, this.targetPos);
      const posForce = posDiff.multiplyScalar(-160.0).sub(this.cameraVel.clone().multiplyScalar(18.0));
      this.cameraVel.add(posForce.multiplyScalar(dt));
      this.cameraPos.add(this.cameraVel.clone().multiplyScalar(dt));
      this.cameraLook.lerp(this.targetLook, 0.15);
    }

    if (camera) {
      camera.fov = this.cameraFov;
      camera.position.copy(this.cameraPos);
      camera.lookAt(this.cameraLook);
      camera.updateProjectionMatrix();
    }

    // ── 3. Technical Typography HUD Update ─────────────────────────
    this._typography.update(time, details, this._themeColorA, this._themeColorB);
  }

  dispose() {
    this._scene.remove(this._group);
    this._shardMesh.geometry.dispose();
    this._shardMat.dispose();
    this._ribbon.geometry.dispose();
    this._ribbonMat.dispose();
    this._wireMesh.geometry.dispose();
    this._wireMesh.material.dispose();
    this._grid.geometry.dispose();
    this._grid.material.dispose();
    this._hudMesh.geometry.dispose();
    this._hudMat.dispose();
    this._typography.dispose();
  }
}

