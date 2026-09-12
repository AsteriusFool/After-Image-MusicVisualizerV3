'use strict';
import * as THREE from '../lib/three.module.js';
import { auraVertexShader, auraFragmentShader } from '../shaders/aura.glsl.js';
import { DEFAULT_PALETTE } from '../album-color.js';

/**
 * Album Aura — a dedicated preset whose entire color identity comes from
 * the currently playing Spotify track's cover art (see album-color.js),
 * updating live as tracks change. Deliberately isolated from the app's
 * global color-theme system in both directions: switching the Palette
 * dropdown never touches this mode (its `setTheme` is a no-op below), and
 * this mode's extracted colors never leak into any other visualizer. Falls
 * back to a fixed default palette until a real one arrives, so the mode is
 * never blank — whether Spotify isn't connected yet, or a track's art
 * turned out to be too monochrome to extract anything useful from. Once a
 * track's actual cover art arrives (setAlbumArt), it's shown as a still,
 * fixed-size centered square, tinted by the palette — see aura.glsl.js —
 * inside this same mode rather than as a separate visualizer, so "Album
 * Aura" stays one cohesive preset whether or not real art has loaded yet.
 * Renders on its own full-screen quad, the same pattern as Live Shader.
 */
// How long a palette crossfade takes, in seconds, and its ease-in/ease-out
// curve — a bounded, time-based fade reads as a deliberate morph, unlike an
// exponential per-frame decay (which moves fastest right at the start and
// so still looks like a sudden change even though it's technically gradual).
const TRANSITION_SECONDS = 2.2;
const smoothstep = t => t * t * (3 - 2 * t);

export class AuraViz {
  constructor(_scene, _freqTex) {
    const p = DEFAULT_PALETTE;

    // A 1x1 placeholder so the samplers always have *something* bound (some
    // WebGL drivers warn about an unbound sampler even if the shader never
    // reads it) — also doubles as the starting point for the very first
    // real cover art's fade-in, so even that isn't an instant pop.
    this._placeholderTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    this._placeholderTexture.needsUpdate = true;
    this._fromArtTexture = this._placeholderTexture;
    this._toArtTexture = this._placeholderTexture;

    this._mat = new THREE.ShaderMaterial({
      vertexShader: auraVertexShader,
      fragmentShader: auraFragmentShader,
      uniforms: {
        uColorA: { value: new THREE.Color().setRGB(...p.colorA) },
        uColorB: { value: new THREE.Color().setRGB(...p.colorB) },
        uColorC: { value: new THREE.Color().setRGB(...p.colorC) },
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uBass: { value: 0 },
        uKick: { value: 0 },
        uBeat: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uAlbumArtFrom: { value: this._fromArtTexture },
        uAlbumArtTo: { value: this._toArtTexture },
        uArtTransition: { value: 1 },
        uHasAlbumArt: { value: 0 },
      },
      depthWrite: false,
      depthTest: false,
    });

    this._quadScene = new THREE.Scene();
    this._quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._mat);
    this._quadScene.add(this._mesh);

    // A genuine crossfade, not a decay: `_from*` is where the fade started,
    // `_to*` is where it's headed, and `_transitionT` (0→1 over
    // TRANSITION_SECONDS, eased) is how far along it is. update() blends
    // between them every frame. setPalette() re-arms this using whatever's
    // currently on screen as the new starting point, so a palette change
    // that interrupts an in-progress fade eases onward instead of jumping.
    this._fromColorA = new THREE.Color().setRGB(...p.colorA);
    this._fromColorB = new THREE.Color().setRGB(...p.colorB);
    this._fromColorC = new THREE.Color().setRGB(...p.colorC);
    this._toColorA = this._fromColorA.clone();
    this._toColorB = this._fromColorB.clone();
    this._toColorC = this._fromColorC.clone();
    this._transitionT = 1; // 1 = fully settled on `_to*`, nothing to animate

    // Same idea, for the cover art texture itself — see setAlbumArt().
    this._artTransitionT = 1;

    this._startTime = null;
    this._lastFrameTime = null;
    this._beat = 0;
  }

  /** Read by visualizer.js: when both are present, this mode renders its own quad. */
  get quadScene() { return this._quadScene; }
  get quadCamera() { return this._quadCamera; }

  /**
   * Sets the live palette extracted from the current track's album art.
   * Each color is a 0-1 RGB triple. Starts a fresh ~2-second crossfade from
   * whatever's currently visible to these new colors — see the constructor's
   * note on how `_from*`/`_to*`/`_transitionT` work together.
   */
  setPalette(colorA, colorB, colorC) {
    const eased = smoothstep(Math.min(1, Math.max(0, this._transitionT)));
    if (colorA) { this._fromColorA.lerp(this._toColorA, eased); this._toColorA.setRGB(...colorA); }
    if (colorB) { this._fromColorB.lerp(this._toColorB, eased); this._toColorB.setRGB(...colorB); }
    if (colorC) { this._fromColorC.lerp(this._toColorC, eased); this._toColorC.setRGB(...colorC); }
    this._transitionT = 0;
  }

  /**
   * Sets the current track's cover art (an HTMLImageElement, already loaded
   * by album-color.js while extracting the palette — no second fetch here).
   * Starts a fresh ~2-second crossfade from whatever's currently on screen
   * to this new image — see aura.glsl.js, which samples both uAlbumArtFrom
   * and uAlbumArtTo and blends them by uArtTransition, exactly mirroring
   * how setPalette() crossfades the colors. Unlike the color crossfade,
   * this doesn't blend-and-freeze the exact mid-fade frame if interrupted
   * by another track changing quickly — it re-arms from wherever the fade
   * was heading, which would need an extra render-to-texture pass to do
   * pixel-perfectly and isn't worth it for how rarely that timing lines up.
   */
  setAlbumArt(image) {
    if (!image) return;
    const orphaned = this._fromArtTexture;
    this._fromArtTexture = this._toArtTexture;
    const texture = new THREE.Texture(image);
    texture.needsUpdate = true;
    this._toArtTexture = texture;
    this._mat.uniforms.uAlbumArtFrom.value = this._fromArtTexture;
    this._mat.uniforms.uAlbumArtTo.value = this._toArtTexture;
    this._artTransitionT = 0;
    this._mat.uniforms.uHasAlbumArt.value = 1;
    // Free the texture that just got bumped out of the fade entirely —
    // but never the shared 1x1 placeholder, which isn't per-track and is
    // reused/disposed once, not per swap.
    if (orphaned && orphaned !== this._placeholderTexture) orphaned.dispose();
  }

  // Intentionally a no-op — visualizer.js calls setTheme() on every mode
  // build and theme change, but this mode's colors come only from
  // setPalette(), never from the app's global Neon/Fire/Ocean… theme list.
  setTheme() {}

  setResolution(width, height) {
    this._mat.uniforms.uResolution.value.set(width, height);
  }

  update(time, energy, beat, details = {}) {
    if (this._startTime === null) this._startTime = time;
    const dt = this._lastFrameTime !== null ? Math.max(0, Math.min(0.1, time - this._lastFrameTime)) : 1 / 60;
    this._lastFrameTime = time;
    this._mat.uniforms.uTime.value = time - this._startTime;

    // Advance the crossfade by real elapsed time (not a fixed per-frame
    // step), so the ~2-second morph takes the same time regardless of frame
    // rate, then blend the visible colors between where it started and
    // where it's headed using an ease-in/ease-out curve.
    if (this._transitionT < 1) {
      this._transitionT = Math.min(1, this._transitionT + dt / TRANSITION_SECONDS);
    }
    const eased = smoothstep(this._transitionT);
    this._mat.uniforms.uColorA.value.copy(this._fromColorA).lerp(this._toColorA, eased);
    this._mat.uniforms.uColorB.value.copy(this._fromColorB).lerp(this._toColorB, eased);
    this._mat.uniforms.uColorC.value.copy(this._fromColorC).lerp(this._toColorC, eased);

    // Same crossfade timing, applied to the cover art texture — see setAlbumArt().
    if (this._artTransitionT < 1) {
      this._artTransitionT = Math.min(1, this._artTransitionT + dt / TRANSITION_SECONDS);
    }
    this._mat.uniforms.uArtTransition.value = smoothstep(this._artTransitionT);

    const safeEnergy = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0;
    this._mat.uniforms.uEnergy.value += (safeEnergy - this._mat.uniforms.uEnergy.value) * 0.1;
    this._mat.uniforms.uBass.value = details.bass ?? 0;
    this._mat.uniforms.uKick.value = details.kick ?? (beat ? 0.7 : 0);

    this._beat *= 0.88;
    if (beat) this._beat = 1;
    this._mat.uniforms.uBeat.value = this._beat;
  }

  dispose() {
    this._quadScene.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mat.dispose();
    if (this._fromArtTexture !== this._placeholderTexture) this._fromArtTexture?.dispose();
    if (this._toArtTexture !== this._placeholderTexture && this._toArtTexture !== this._fromArtTexture) {
      this._toArtTexture?.dispose();
    }
    this._placeholderTexture.dispose();
  }
}
