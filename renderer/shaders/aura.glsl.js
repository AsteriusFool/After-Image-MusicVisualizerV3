'use strict';

/**
 * Album Aura's background — once cover art is available (uHasAlbumArt >
 * 0.5), the background is the album art's OWN colors, heavily warped and
 * color-channel-shifted into a dynamic, melting field that fills the whole
 * frame, rather than an abstract 3-color gradient. Before any art has
 * loaded, it falls back to that abstract flowing gradient (extracted
 * palette — see album-color.js) so the mode is never blank. Either way, a
 * fixed-size, still, undistorted copy of the cover sits centered on top —
 * not full-bleed — as a calm anchor against the shifting backdrop. Cover
 * art crossfades in over ~2 seconds on every track change (uAlbumArtFrom →
 * uAlbumArtTo by uArtTransition, set in aura.js) rather than popping in
 * instantly, mirroring the palette's own crossfade.
 */

export const auraVertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

export const auraFragmentShader = /* glsl */`
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uBass;
  uniform float uKick;
  uniform float uBeat;
  uniform vec2 uResolution;
  uniform sampler2D uAlbumArtFrom;
  uniform sampler2D uAlbumArtTo;
  uniform float uArtTransition;
  uniform float uHasAlbumArt;

  varying vec2 vUv;

  // Blends the outgoing and incoming cover art at one UV — used everywhere
  // the art is sampled, so both the still square and the dynamic background
  // crossfade together in sync on every track change.
  vec3 sampleArt(vec2 artSampleUv) {
    vec3 fromColor = texture2D(uAlbumArtFrom, artSampleUv).rgb;
    vec3 toColor = texture2D(uAlbumArtTo, artSampleUv).rgb;
    return mix(fromColor, toColor, uArtTransition);
  }

  void main() {
    vec2 uv = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float dist = length(uv);

    float t = uTime * 0.15;
    float flowA = sin(uv.x * 2.4 + t * 1.3 + sin(uv.y * 3.1 + t) * 1.5) * 0.5 + 0.5;
    float flowB = sin(uv.y * 2.0 - t * 1.1 + cos(uv.x * 2.7 - t * 0.7) * 1.4) * 0.5 + 0.5;

    vec3 gradient = mix(uColorA, uColorB, flowA);
    gradient = mix(gradient, uColorC, flowB * 0.6);

    // A steady (non-beat-pulsed) version of the same palette mix, for
    // blending into the dynamic background below — it still shifts hue
    // continuously as flowA/flowB evolve with uTime, just without the
    // per-beat brightness jump gradient gets a few lines down.
    vec3 steadyGradient = gradient;

    float glow = smoothstep(1.2, 0.0, dist) * (0.35 + uEnergy * 0.55 + uBass * 0.3);
    gradient += glow * uColorB * 0.5;
    gradient *= 0.75 + uBeat * 0.35 + uKick * 0.25;

    vec3 color = gradient;

    if (uHasAlbumArt > 0.5) {
      // ── Dynamic background: the album art's own colors, warped and
      // channel-shifted, filling the whole frame. A second, larger/slower
      // flow field drives a continuous "melting" motion purely from time
      // (uTime) — deliberately NOT scaled by bass/kick/beat, which would
      // make it visibly jump/twitch on every hit instead of just flowing.
      float bt = uTime * 0.07;
      float bgFlowA = sin(uv.x * 1.5 + bt * 1.2 + sin(uv.y * 2.1 - bt * 0.8) * 2.2) * 0.5 + 0.5;
      float bgFlowB = sin(uv.y * 1.3 - bt * 0.9 + cos(uv.x * 1.8 + bt * 0.6) * 2.2) * 0.5 + 0.5;

      vec2 bgBase = uv * 0.62 + 0.5 + vec2(bgFlowA - 0.5, bgFlowB - 0.5) * 0.4;
      vec2 shiftAmt = vec2(0.025, 0.02);

      // fract() wraps the sample coordinate into 0-1 ourselves rather than
      // relying on the texture's own wrap mode — needed since Spotify art
      // isn't power-of-two sized, and WebGL1 only allows edge-clamping (not
      // hardware repeat) on non-power-of-two textures.
      vec3 bgArt;
      bgArt.r = sampleArt(fract(bgBase + shiftAmt)).r;
      bgArt.g = sampleArt(fract(bgBase)).g;
      bgArt.b = sampleArt(fract(bgBase - shiftAmt)).b;

      // A fixed brightness rather than one scaled by energy/beat — the
      // color-shifted melt keeps moving on its own; it doesn't also need
      // to flash to feel alive.
      vec3 background = mix(bgArt, steadyGradient, 0.3);
      background *= 0.72;
      color = background;

      // ── The still, fixed-size centered square — a calm anchor against
      // the shifting backdrop above. Unwarped, unpulsed, on purpose.
      const float halfSize = 0.24;
      vec2 edgeDist2 = abs(uv) - vec2(halfSize);
      float edgeDist = max(edgeDist2.x, edgeDist2.y); // <0 inside, 0 on the edge, >0 outside

      // Map the square's interior onto the full 0-1 texture range — dividing
      // by the same halfSize on both axes keeps it square regardless of
      // window aspect, since uv already has equal real-world scale in x/y.
      vec2 artUv = uv / (2.0 * halfSize) + 0.5;

      vec3 art = sampleArt(clamp(artUv, 0.0, 1.0));
      vec3 tintedArt = art * mix(vec3(1.0), gradient * 1.3, 0.22);

      float edgeSoftness = 0.008;
      float insideMask = 1.0 - smoothstep(0.0, edgeSoftness, edgeDist);
      float halo = smoothstep(0.22, 0.0, max(edgeDist, 0.0)) * (0.35 + uEnergy * 0.4);

      color = mix(color, tintedArt, insideMask);
      color += halo * uColorB * (1.0 - insideMask);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;
