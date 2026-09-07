// EXC3_CM3 High-Energy Motion Graphics & Typography Shaders
// Zero syntax errors, WebGL 1 / Three.js compatible GLSL

export const shardVertexShader = /* glsl */`
  attribute float aFreqIdx;
  uniform sampler2D uFreqTex;
  uniform float uTime;
  uniform float uKick;
  uniform float uSnare;
  uniform float uPhase;
  uniform float uEnergy;

  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vFreq;
  varying float vKick;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * (mat3(instanceMatrix) * normal));
    vKick = uKick;

    // Sample audio frequency for this shard
    float freq = texture2D(uFreqTex, vec2(aFreqIdx, 0.5)).r;
    vFreq = freq;

    // Normal displacement driven by frequency and bass kick
    vec3 displaced = position + normal * (freq * 0.75 + uKick * 0.55);

    // Procedural micro-jitter on snare hits
    if (uSnare > 0.4) {
      displaced += normal * (sin(uTime * 45.0 + position.y * 10.0) * uSnare * 0.08);
    }

    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(displaced, 1.0);
  }
`;

export const shardFragmentShader = /* glsl */`
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uKick;
  uniform float uSnare;
  uniform float uEnergy;

  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vFreq;
  varying float vKick;

  void main() {
    // Sharp faceted directional lighting
    vec3 lightDir = normalize(vec3(0.5, 0.8, 0.6));
    float diff = max(0.08, dot(vNormal, lightDir));

    // High-contrast monochrome base with theme accent edge highlights
    vec3 baseColor = vec3(diff * 0.82);
    vec3 accentColor = mix(uColorA, uColorB, vFreq);

    // Rim lighting
    float rim = 1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
    rim = pow(rim, 2.5);

    vec3 col = mix(baseColor, accentColor, rim * 0.75 + vFreq * 0.25);

    // Accent flash on kick impact
    col += accentColor * (uKick * 0.45);

    // Single-frame white flash on snare
    col += vec3(uSnare * 0.6);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const ribbonVertexShader = /* glsl */`
  uniform sampler2D uFreqTex;
  uniform float uTime;
  uniform float uKick;
  uniform float uPhase;

  varying vec2 vUv;
  varying float vWave;

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Audio-driven vertical undulation
    float freq = texture2D(uFreqTex, vec2(uv.x, 0.5)).r;
    float wave = sin(pos.x * 1.8 + uTime * 6.0 + uPhase * 6.28318) * (freq * 1.4 + uKick * 0.85);
    pos.y += wave;
    pos.z += cos(pos.x * 1.2 + uTime * 4.0) * (freq * 0.6);

    vWave = freq;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const ribbonFragmentShader = /* glsl */`
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uKick;
  uniform float uTime;

  varying vec2 vUv;
  varying float vWave;

  void main() {
    // Technical zebra / barcode striping
    float stripe = step(0.5, fract(vUv.x * 64.0));
    vec3 col = mix(vec3(0.08), vec3(0.95), stripe);

    // Accent line along edges
    float edge = smoothstep(0.05, 0.0, vUv.y) + smoothstep(0.95, 1.0, vUv.y);
    col = mix(col, uColorB, edge * 0.85);

    col += mix(uColorA, vec3(1.0), 0.5) * (uKick * 0.4);
    gl_FragColor = vec4(col, 0.92);
  }
`;

export const hudVertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const hudFragmentShader = /* glsl */`
  uniform sampler2D uHudTex;
  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(uHudTex, vUv);
    gl_FragColor = tex;
  }
`;

export const exc3PostVertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

export const exc3PostFragmentShader = /* glsl */`
  uniform sampler2D uScene;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uKick;
  uniform float uSnare;
  uniform float uHigh;
  uniform float uPhase;

  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;

    // ── 1. Glitch Slice Displacement ──────────────────────────────
    float sliceCount = 36.0;
    float sliceY = floor(uv.y * sliceCount);
    float sliceNoise = fract(sin(sliceY * 78.233 + floor(uTime * 28.0)) * 43758.5453);
    float glitchThreshold = 0.965 - (uKick * 0.12 + uSnare * 0.10);

    if (sliceNoise > glitchThreshold) {
      float sliceOffset = (fract(sliceNoise * 31.4159) - 0.5) * (0.025 + uKick * 0.06);
      uv.x = fract(uv.x + sliceOffset);
    }

    // ── 2. Kick-Driven Radial Chromatic Aberration ─────────────────
    vec2 dir = uv - vec2(0.5);
    float dist = length(dir);
    vec2 shift = dir * (uKick * 0.028 + 0.002);

    float r = texture2D(uScene, clamp(uv - shift, vec2(0.001), vec2(0.999))).r;
    float g = texture2D(uScene, clamp(uv, vec2(0.001), vec2(0.999))).g;
    float b = texture2D(uScene, clamp(uv + shift, vec2(0.001), vec2(0.999))).b;
    vec3 col = vec3(r, g, b);

    // ── 3. Horizontal Scanlines ───────────────────────────────────
    float scanline = sin(uv.y * uResolution.y * 1.5) * 0.065;
    col -= vec3(scanline);

    // ── 4. Snare Flash & Color Inversion ──────────────────────────
    if (uSnare > 0.60) {
      float invStrength = min(1.0, (uSnare - 0.60) * 2.5);
      // Partial to full monochrome color inversion for single-frame impact
      col = mix(col, vec3(1.0) - col, invStrength);
      col += vec3((uSnare - 0.60) * 0.45);
    }

    // ── 5. Lightweight Film Grain ─────────────────────────────────
    float grain = fract(sin(dot(uv * uResolution + vec2(fract(uTime * 19.3) * 100.0), vec2(12.9898, 78.233))) * 43758.5453);
    col += (grain - 0.5) * 0.062;

    // High-contrast industrial grade
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

