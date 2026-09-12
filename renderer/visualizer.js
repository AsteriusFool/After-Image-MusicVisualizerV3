'use strict';
import * as THREE from './lib/three.module.js';
import { BarsViz }      from './viz/bars.js';
import { OrbViz }       from './viz/orb.js';
import { ParticlesViz } from './viz/particles.js';
import { TunnelViz }    from './viz/tunnel.js';
import { AmbientEffects } from './effects.js';
import { RandomViz }     from './viz/random.js';
import { SpeakerViz }    from './viz/speaker.js';
import { Exc3Viz }       from './viz/exc3.js';
import { ImpulseViz }    from './viz/impulse.js';
import { CustomViz, DEFAULT_FRAGMENT_SOURCE } from './viz/custom.js';
import { AuraViz } from './viz/aura.js';
import { retroVertexShader, retroFragmentShader } from './shaders/retro.glsl.js';
import { exc3PostVertexShader, exc3PostFragmentShader } from './shaders/exc3.glsl.js';

/** Themes: [colorA, colorB] as normalised RGB triples. */
export const THEMES = {
  neon:   { a: [0.45, 0.0, 1.0],  b: [0.0, 0.75, 1.0]  },
  fire:   { a: [1.0, 0.08, 0.0],  b: [1.0, 0.75, 0.0]  },
  ocean:  { a: [0.0, 0.12, 0.85], b: [0.0, 0.85, 0.65]  },
  aurora: { a: [0.0, 0.75, 0.25], b: [0.5, 0.0,  0.9]  },
  sunset: { a: [1.0, 0.08, 0.35], b: [1.0, 0.65, 0.05]  },
  ice:    { a: [0.15, 0.55, 1.0], b: [0.7, 0.95, 1.0]  },
  toxic:  { a: [0.55, 1.0, 0.0], b: [0.0, 0.95, 0.45]  },
  candy:  { a: [1.0, 0.15, 0.7], b: [0.35, 0.25, 1.0]  },
};

export class Visualizer {
  constructor(canvas) {
    this._canvas   = canvas;
    this._vizMode  = 'bars';
    this._theme    = 'neon';
    this._active   = null;
    this._customShaderSource = DEFAULT_FRAGMENT_SOURCE;
    this._auraPalette = null;
    this._auraImage = null;

    // Retro CRT grade — target is what the user asked for, amount eases toward it.
    this._retroTarget = 1;
    this._retroAmount = 1;

    // ── Renderer ──────────────────────────────────────────────────
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._renderer.setClearColor(0x000000, 0);
    this._feedbackRead = new THREE.WebGLRenderTarget(1, 1);
    this._feedbackWrite = new THREE.WebGLRenderTarget(1, 1);
    this._postScene = new THREE.Scene();
    this._postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._postCamera.position.z = 1;
    this._postMaterial = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D uCurrent;
        uniform sampler2D uPrevious;
        uniform vec2 uTexel;
        void main() {
          vec3 current = texture2D(uCurrent, vUv).rgb;
          vec3 previous = texture2D(uPrevious, vUv + vec2(-uTexel.x * 5.0, 0.0)).rgb;
          vec3 bloom = vec3(0.0);
          bloom += texture2D(uCurrent, vUv + uTexel * vec2(1.5, 0.0)).rgb;
          bloom += texture2D(uCurrent, vUv - uTexel * vec2(1.5, 0.0)).rgb;
          bloom += texture2D(uCurrent, vUv + uTexel * vec2(0.0, 1.5)).rgb;
          bloom += texture2D(uCurrent, vUv - uTexel * vec2(0.0, 1.5)).rgb;
          vec3 color = min(current * 1.4 + bloom * 0.42 + previous * 0.48, vec3(4.0));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      uniforms: {
        uCurrent: { value: null },
        uPrevious: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      depthWrite: false,
      depthTest: false,
    });
    this._postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._postMaterial));

    // ── Retro post-processing pass ───────────────────────────────
    // Every visualisation renders into this target, then gets composited to the
    // screen through the CRT / synthwave grade below.
    this._sceneRT = new THREE.WebGLRenderTarget(1, 1);
    this._retroScene = new THREE.Scene();
    this._retroMaterial = new THREE.ShaderMaterial({
      vertexShader: retroVertexShader,
      fragmentShader: retroFragmentShader,
      uniforms: {
        uScene:      { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime:       { value: 0 },
        uBeat:       { value: 0 },
        uEnergy:     { value: 0 },
        uAmount:     { value: this._retroAmount },
      },
      depthWrite: false,
      depthTest: false,
    });
    this._retroScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._retroMaterial));

    // ── EXC3 Motion Graphics post-processing pass ──────────────────
    this._exc3Material = new THREE.ShaderMaterial({
      vertexShader: exc3PostVertexShader,
      fragmentShader: exc3PostFragmentShader,
      uniforms: {
        uScene:      { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime:       { value: 0 },
        uKick:       { value: 0 },
        uSnare:      { value: 0 },
        uHigh:       { value: 0 },
        uPhase:      { value: 0 },
      },
      depthWrite: false,
      depthTest: false,
    });
    this._exc3Scene = new THREE.Scene();
    this._exc3Scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._exc3Material));

    // Dynamic resolution scaling for stable 60 FPS
    this._scale = 1.0;
    this._lastFrameTime = performance.now();
    this._frameTimes = [];

    // ── Scene & Camera ────────────────────────────────────────────
    this._scene  = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    this._baseCamPos  = new THREE.Vector3(0, 5, 8);
    this._baseCamLook = new THREE.Vector3(0, 0, 0);
    this._mouseParallax = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this._kickImpulse = 0;

    this._camera.position.copy(this._baseCamPos);
    this._camera.lookAt(this._baseCamLook);

    window.addEventListener('mousemove', e => {
      this._mouseParallax.targetX = (e.clientX / window.innerWidth - 0.5) * 2;
      this._mouseParallax.targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    });

    // ── DataTexture — 256×1 RGBA carrying normalised FFT bins ─────
    this._freqData = new Uint8Array(256 * 4);
    this._freqTex  = new THREE.DataTexture(
      this._freqData, 256, 1,
      THREE.RGBAFormat, THREE.UnsignedByteType,
    );
    this._freqTex.needsUpdate = true;
    this._effects = new AmbientEffects(this._scene, this._freqTex);
    this._effects.setVisible(false);

    // ── Resize handling ───────────────────────────────────────────
    window.addEventListener('resize', () => this._onResize());
    this._onResize();

    // ── Build default visualisation ───────────────────────────────
    this._buildViz(this._vizMode);
  }

  // ── Public API ─────────────────────────────────────────────────

  setViz(mode) {
    if (mode === this._vizMode) return;
    this._vizMode = mode;
    this._buildViz(mode);
  }

  /** Toggle / set the retro CRT grade. Accepts a boolean. */
  setRetro(on) {
    this._retroTarget = on ? 1 : 0;
  }

  get retroEnabled() { return this._retroTarget === 1; }

  setTheme(name) {
    if (!THEMES[name]) return;
    this._theme = name;
    const t = THEMES[name];
    this._effects?.setTheme(t.a, t.b);
    this._active?.setTheme(t.a, t.b);
  }

  /**
   * Applies a new fragment shader to the live-shader ("Live Shader" preset) mode.
   * Safe to call any time; if that mode isn't active yet the source is kept
   * and used the next time it's entered.
   * @returns {{ok: boolean, error: (string|null)}}
   */
  setCustomShader(source) {
    this._customShaderSource = source;
    if (this._vizMode === 'custom' && this._active?.setShader) {
      return this._active.setShader(source);
    }
    return { ok: true, error: null };
  }

  /** Reverts the live-shader mode to its built-in starter shader. */
  resetCustomShader() {
    return this.setCustomShader(DEFAULT_FRAGMENT_SOURCE);
  }

  /** Current live-shader fragment source, for prefilling the editor panel. */
  getCustomShaderSource() {
    return this._active?.getSource ? this._active.getSource() : this._customShaderSource;
  }

  /** Sets Album Aura's live palette (each color a 0-1 RGB triple), e.g. from the current Spotify track's cover art. */
  setAuraPalette(colorA, colorB, colorC) {
    this._auraPalette = { colorA, colorB, colorC };
    if (this._vizMode === 'aura' && this._active?.setPalette) {
      this._active.setPalette(colorA, colorB, colorC);
    }
  }

  /** Sets Album Aura's cover-art image (an HTMLImageElement) — shown warped/tinted inside the mode itself, not as a separate visualizer. */
  setAuraArt(image) {
    this._auraImage = image;
    if (this._vizMode === 'aura' && this._active?.setAlbumArt) {
      this._active.setAlbumArt(image);
    }
  }

  /**
   * Call once per frame with the latest analyser output.
   * @param {Float32Array} bins      256-element normalised frequency array.
   * @param {number}       energy    Mean energy 0–1.
   * @param {boolean}      beat      True on beat onset.
   * @param {Object}       [details] Optional transient telemetry (kick, snare, bass, mid, treble).
   */
  render(bins, energy, beat, details = {}) {
    this._updateFreqTex(bins);

    const time = performance.now() * 0.001;
    const kick = details.kick ?? (beat ? 0.7 : 0);

    // ── Kinetic Camera Physics ─────────────────────────────────────
    this._mouseParallax.x += (this._mouseParallax.targetX - this._mouseParallax.x) * 0.05;
    this._mouseParallax.y += (this._mouseParallax.targetY - this._mouseParallax.y) * 0.05;

    if (kick > 0.55) {
      this._kickImpulse = Math.max(this._kickImpulse, (kick - 0.55) * 0.4);
    }
    this._kickImpulse *= 0.82; // swift exponential recoil decay

    const driftX = Math.sin(time * 0.42) * 0.09;
    const driftY = Math.cos(time * 0.31) * 0.06;

    const isTunnel  = this._vizMode === 'tunnel';
    const isSpeaker = this._vizMode === 'speaker';
    const pScale    = isTunnel ? 0.06 : (isSpeaker ? 0.12 : 0.35);

    const offsetX = this._mouseParallax.x * pScale + driftX;
    const offsetY = -this._mouseParallax.y * (pScale * 0.7) + driftY;
    const recoilZ = this._kickImpulse * (isTunnel ? -0.06 : (isSpeaker ? -0.10 : 0.12));

    // Dynamic Resolution Scaling to guarantee stable 60 FPS
    const nowMs = performance.now();
    const frameMs = nowMs - this._lastFrameTime;
    this._lastFrameTime = nowMs;
    this._frameTimes.push(frameMs);
    if (this._frameTimes.length > 30) this._frameTimes.shift();

    if (this._frameTimes.length >= 20) {
      let avgMs = 0;
      for (let i = 0; i < this._frameTimes.length; i++) avgMs += this._frameTimes[i];
      avgMs /= this._frameTimes.length;

      if (avgMs > 17.5 && this._scale > 0.70) {
        this._scale = Math.max(0.70, this._scale - 0.05);
        this._resizeRenderTargets();
      } else if (avgMs < 13.5 && this._scale < 1.0) {
        this._scale = Math.min(1.0, this._scale + 0.05);
        this._resizeRenderTargets();
      }
    }

    if (this._vizMode !== 'exc3' && !this._active?.quadScene) {
      this._camera.position.set(
        this._baseCamPos.x + offsetX,
        this._baseCamPos.y + offsetY,
        this._baseCamPos.z + recoilZ,
      );
      this._camera.lookAt(
        this._baseCamLook.x + offsetX * 0.25,
        this._baseCamLook.y + offsetY * 0.25,
        this._baseCamLook.z,
      );
    }

    if (this._vizMode === 'random') {
      this._effects?.update(time, energy, beat, details);
    }
    this._active?.update(time, energy, beat, details, this._camera);

    // ── Pass 1 — draw active visualization into offscreen sceneRT ──
    if (this._vizMode === 'speaker') {
      this._renderer.setRenderTarget(this._feedbackWrite);
      this._renderer.clear();
      this._renderer.render(this._scene, this._camera);
      this._postMaterial.uniforms.uCurrent.value = this._feedbackWrite.texture;
      this._postMaterial.uniforms.uPrevious.value = this._feedbackRead.texture;
      this._renderer.setRenderTarget(this._sceneRT);
      this._renderer.render(this._postScene, this._postCamera);
      const previous = this._feedbackRead;
      this._feedbackRead = this._feedbackWrite;
      this._feedbackWrite = previous;
    } else if (this._vizMode === 'exc3') {
      this._renderer.setRenderTarget(this._sceneRT);
      this._renderer.clear();
      this._renderer.render(this._scene, this._camera);
      if (this._active?.hudScene && this._active?.hudCamera) {
        this._renderer.autoClear = false;
        this._renderer.render(this._active.hudScene, this._active.hudCamera);
        this._renderer.autoClear = true;
      }
    } else if (this._active?.quadScene && this._active?.quadCamera) {
      // Live Shader mode owns a full-screen quad instead of anything in the
      // shared 3D scene — render that in place of the usual scene/camera.
      // Checked generically (not by mode name) so any future quad-based
      // mode gets this for free.
      this._renderer.setRenderTarget(this._sceneRT);
      this._renderer.clear();
      this._renderer.render(this._active.quadScene, this._active.quadCamera);
    } else {
      this._renderer.setRenderTarget(this._sceneRT);
      this._renderer.render(this._scene, this._camera);
    }

    // ── Pass 2 — composite through mode-specific post-processing stack ──
    if (this._vizMode === 'exc3') {
      const u = this._exc3Material.uniforms;
      u.uScene.value = this._sceneRT.texture;
      u.uTime.value  = time;
      u.uKick.value  = details.kick ?? (beat ? 0.7 : 0);
      u.uSnare.value = details.snare ?? 0;
      u.uHigh.value  = details.hihat ?? 0;
      u.uPhase.value = details.phase ?? 0;
      this._renderer.setRenderTarget(null);
      this._renderer.render(this._exc3Scene, this._postCamera);
    } else {
      this._retroAmount += (this._retroTarget - this._retroAmount) * 0.12;
      const u = this._retroMaterial.uniforms;
      u.uScene.value  = this._sceneRT.texture;
      u.uTime.value   = time;
      u.uBeat.value   = beat ? 1.0 : 0.0;
      u.uEnergy.value = energy;
      u.uAmount.value = this._retroAmount;
      this._renderer.setRenderTarget(null);
      this._renderer.render(this._retroScene, this._postCamera);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────

  _buildViz(mode) {
    this._active?.dispose();

    const t = THEMES[this._theme];
    switch (mode) {
      case 'orb':
        this._active = new OrbViz(this._scene, this._freqTex);
        break;
      case 'particles':
        this._active = new ParticlesViz(this._scene, this._freqTex);
        break;
      case 'tunnel':
        this._active = new TunnelViz(this._scene, this._freqTex);
        break;
      case 'random':
        this._active = new RandomViz(this._scene, this._freqTex);
        break;
      case 'speaker':
        this._active = new SpeakerViz(this._scene, this._freqTex);
        break;
      case 'exc3':
        this._active = new Exc3Viz(this._scene, this._freqTex);
        break;
      case 'impulse':
        this._active = new ImpulseViz(this._scene, this._freqTex);
        break;
      case 'custom':
        this._active = new CustomViz(this._scene, this._freqTex, this._customShaderSource);
        break;
      case 'aura':
        this._active = new AuraViz(this._scene, this._freqTex);
        if (this._auraPalette) this._active.setPalette(this._auraPalette.colorA, this._auraPalette.colorB, this._auraPalette.colorC);
        if (this._auraImage) this._active.setAlbumArt(this._auraImage);
        break;
      default:
        this._active = new BarsViz(this._scene, this._freqTex);
        break;
    }
    this._effects.setVisible(mode === 'random');
    this._effects?.setTheme(t.a, t.b);
    this._active.setTheme(t.a, t.b);
    this._setCameraForMode(mode);
    // Newly-built modes (Live Shader in particular) need the current render
    // resolution immediately, not just on the next window resize.
    this._resizeRenderTargets();
  }

  _setCameraForMode(mode) {
    if (mode === 'tunnel') {
      this._baseCamPos.set(0, 0.15, 1.1);
      this._baseCamLook.set(0, 0, -4.5);
      this._scene.background = null;
    } else if (mode === 'random') {
      this._baseCamPos.set(0, 0, 10);
      this._baseCamLook.set(0, 0, 0);
      this._scene.background = null;
    } else if (mode === 'speaker') {
      this._baseCamPos.set(0, 0.55, 3.0);
      this._baseCamLook.set(0, -0.15, -14);
      this._scene.background = new THREE.Color(0x000000);
      this._resetFeedback();
    } else if (mode === 'exc3') {
      this._scene.background = new THREE.Color(0x060608);
      this._baseCamPos.set(0, 0.8, 6.2);
      this._baseCamLook.set(0, 0, 0);
    } else if (mode === 'impulse') {
      this._scene.background = null;
      this._baseCamPos.set(0, 1.2, 8.5);
      this._baseCamLook.set(0, 0, 0);
    } else if (mode === 'custom') {
      this._scene.background = new THREE.Color(0x05050a);
      this._baseCamPos.set(0, 0, 7);
      this._baseCamLook.set(0, 0, 0);
    } else if (mode === 'aura') {
      this._scene.background = new THREE.Color(0x050508);
      this._baseCamPos.set(0, 0, 7);
      this._baseCamLook.set(0, 0, 0);
    } else {
      this._scene.background = null;
      this._baseCamPos.set(0, 5, 8);
      this._baseCamLook.set(0, 0, 0);
    }

    this._camera.position.copy(this._baseCamPos);
    this._camera.lookAt(this._baseCamLook);
    this._camera.fov = 55;
    this._camera.updateProjectionMatrix();
  }

  _resetFeedback() {
    this._renderer.setRenderTarget(this._feedbackRead);
    this._renderer.clear();
    this._renderer.setRenderTarget(this._feedbackWrite);
    this._renderer.clear();
    this._renderer.setRenderTarget(null);
  }

  _updateFreqTex(bins) {
    for (let i = 0; i < 256; i++) {
      const v = Math.floor(bins[i] * 255);
      const o = i * 4;
      this._freqData[o] = this._freqData[o + 1] = this._freqData[o + 2] = v;
      this._freqData[o + 3] = 255;
    }
    this._freqTex.needsUpdate = true;
  }

  _resizeRenderTargets() {
    const w = window.innerWidth, h = window.innerHeight;
    const pixelRatio = Math.min(devicePixelRatio, 2) * this._scale;
    const rw = Math.max(1, Math.floor(w * pixelRatio));
    const rh = Math.max(1, Math.floor(h * pixelRatio));
    this._feedbackRead.setSize(rw, rh);
    this._feedbackWrite.setSize(rw, rh);
    this._sceneRT.setSize(rw, rh);
    this._postMaterial.uniforms.uTexel.value.set(1 / rw, 1 / rh);
    this._retroMaterial.uniforms.uResolution.value.set(rw, rh);
    this._exc3Material.uniforms.uResolution.value.set(rw, rh);
    this._active?.setResolution?.(rw, rh);
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this._renderer.setSize(w, h);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._resizeRenderTargets();
  }
}
