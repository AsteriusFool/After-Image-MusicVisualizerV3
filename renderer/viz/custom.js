'use strict';
import * as THREE from '../lib/three.module.js';

/**
 * Live-shader / creative-coding mode.
 * A full-screen quad, rendered through its own orthographic camera — the
 * classic Shadertoy setup — so a custom fragment shader has the whole frame
 * to itself instead of being mapped onto some fixed 3D shape. `visualizer.js`
 * detects this mode (via `quadScene`/`quadCamera`) and renders it in place of
 * the shared 3D scene entirely.
 *
 * Available to a custom fragment shader:
 *   varying vec2 vUv;                 0-1 across the whole frame (not aspect-corrected —
 *                                     see the default shader for the standard fix:
 *                                     `(vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0)`)
 *   uniform vec2  uResolution;        frame size in pixels
 *   uniform vec3  uColorA, uColorB;   active theme colors
 *   uniform float uTime;              seconds since this mode was entered
 *   uniform float uEnergy;            0-1 overall loudness
 *   uniform float uBeat;              decays from 1 on each detected beat
 *   uniform float uKick, uSnare, uHihat;  0-1 percussive transients
 *   uniform float uBass, uMid, uTreble;   0-1 continuous band levels
 *   uniform sampler2D uFreqTex;       256x1 FFT texture, sample at (x, 0.5)
 */

export const DEFAULT_FRAGMENT_SOURCE = `uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uTime;
uniform float uEnergy;
uniform float uBeat;
uniform float uKick;
uniform vec2 uResolution;
uniform sampler2D uFreqTex;

varying vec2 vUv;

void main() {
  // Aspect-corrected, screen-centered coordinates — the standard first line
  // of any full-screen shader, so circles stay circular at any window size.
  vec2 uv = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float dist = length(uv);
  float angle = atan(uv.y, uv.x);

  // Sample the spectrum around the circle: angle -> frequency bin.
  float amp = texture2D(uFreqTex, vec2(fract(angle / 6.28318 + 0.5), 0.5)).r;

  float rings = sin(dist * 18.0 - uTime * 2.5 + amp * 6.0) * 0.5 + 0.5;
  float glow = smoothstep(0.9, 0.0, dist) * (0.4 + uEnergy * 0.8 + uKick * 0.6);

  vec3 color = mix(uColorA, uColorB, dist + amp * 0.5);
  color *= rings * 0.6 + 0.4;
  color += glow * uColorB;
  color *= 0.7 + uBeat * 0.5;

  gl_FragColor = vec4(color, 1.0);
}
`;

// Bare-minimum full-screen-quad vertex shader — position is already in clip
// space (the quad spans -1..1), so this never needs to change.
const VERTEX_SOURCE = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// Only used for the standalone pre-flight compile check below — Three.js injects
// its own copies of these declarations when it builds the real ShaderMaterial
// program, so this prefix must never be sent to Three itself. `vUv` is NOT
// declared here: a valid fragment shader must declare its own matching
// `varying`s (see DEFAULT_FRAGMENT_SOURCE) — plain GLSL ES 1.00 doesn't share
// varying declarations between stages.
const VALIDATION_PREFIX = `precision highp float;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
`;

/**
 * Compiles `source` as a standalone fragment shader against a scratch WebGL
 * context so a broken edit in the live-shader panel can be rejected with a
 * driver error message instead of corrupting the running THREE.ShaderMaterial.
 */
export function validateFragmentShader(source) {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return { ok: true, error: null };
    const shader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(shader, VALIDATION_PREFIX + source);
    gl.compileShader(shader);
    const ok = !!gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    const error = ok ? null : (gl.getShaderInfoLog(shader) || 'Unknown shader compile error.');
    gl.deleteShader(shader);
    return { ok, error };
  } catch (err) {
    // If the validator itself can't run, don't block the user — let Three attempt it.
    return { ok: true, error: null };
  }
}

export class CustomViz {
  constructor(_scene, freqTex, initialSource) {
    this._startTime = null;
    this._beat = 0;
    // Validate even the *initial* source — it may be a restored-from-disk
    // shader (see shader-library.js) that predates a later edit gone wrong,
    // rather than one that already passed through setShader() this session.
    const candidate = initialSource || DEFAULT_FRAGMENT_SOURCE;
    const check = validateFragmentShader(candidate);
    if (!check.ok) console.warn('[custom-viz] restored shader failed to compile, falling back to default:', check.error);
    this._source = check.ok ? candidate : DEFAULT_FRAGMENT_SOURCE;

    this._mat = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SOURCE,
      fragmentShader: this._source,
      uniforms: {
        uColorA: { value: new THREE.Color() },
        uColorB: { value: new THREE.Color() },
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uBeat: { value: 0 },
        uKick: { value: 0 },
        uSnare: { value: 0 },
        uHihat: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uFreqTex: { value: freqTex },
      },
      depthWrite: false,
      depthTest: false,
    });

    // Its own scene + orthographic camera, exactly like visualizer.js's other
    // full-screen composite passes (retro grade, EXC3 post) — a plain quad
    // spanning clip space, not a shape inside the shared 3D scene.
    this._quadScene = new THREE.Scene();
    this._quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._mat);
    this._quadScene.add(this._mesh);
  }

  /** Read by visualizer.js: when both are present, this mode renders its own quad. */
  get quadScene() { return this._quadScene; }
  get quadCamera() { return this._quadCamera; }

  /** Current applied fragment shader source, for prefilling the editor UI. */
  getSource() {
    return this._source;
  }

  /**
   * Validates and applies a new fragment shader.
   * @returns {{ok: boolean, error: (string|null)}}
   */
  setShader(source) {
    const trimmed = (source || '').trim();
    if (!trimmed) return { ok: false, error: 'Shader source is empty.' };
    const result = validateFragmentShader(trimmed);
    if (!result.ok) return { ok: false, error: result.error };
    this._mat.fragmentShader = trimmed;
    this._mat.needsUpdate = true;
    this._source = trimmed;
    return { ok: true, error: null };
  }

  setTheme(colorA, colorB) {
    this._mat.uniforms.uColorA.value.setRGB(...colorA);
    this._mat.uniforms.uColorB.value.setRGB(...colorB);
  }

  /** Called by visualizer.js on build and on every resize / resolution-scale change. */
  setResolution(width, height) {
    this._mat.uniforms.uResolution.value.set(width, height);
  }

  update(time, energy, beat, details = {}) {
    if (this._startTime === null) this._startTime = time;
    this._mat.uniforms.uTime.value = time - this._startTime;

    const safeEnergy = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0;
    this._mat.uniforms.uEnergy.value += (safeEnergy - this._mat.uniforms.uEnergy.value) * 0.12;
    this._beat *= 0.9;
    if (beat) this._beat = 1;
    this._mat.uniforms.uBeat.value = this._beat;
    this._mat.uniforms.uKick.value = details.kick ?? (beat ? 0.7 : 0);
    this._mat.uniforms.uSnare.value = details.snare ?? 0;
    this._mat.uniforms.uHihat.value = details.hihat ?? 0;
    this._mat.uniforms.uBass.value = details.bass ?? 0;
    this._mat.uniforms.uMid.value = details.mid ?? 0;
    this._mat.uniforms.uTreble.value = details.treble ?? 0;
  }

  dispose() {
    this._quadScene.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mat.dispose();
  }
}
