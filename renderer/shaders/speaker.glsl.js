// GLSL for the "Wormhole" visualisation (menu name: Neon Wormhole).
//
// The shape is a Morris–Thorne wormhole embedding: a tube whose radius follows
//   r(z) = sqrt(throat² + (z - throatZ)² / flare²)
// so it pinches to a narrow throat and flares open toward both mouths. The
// camera sits just inside the near mouth looking through the throat at a
// swirling starfield on the "other side".

// ── Shared geometry constants (kept in sync with speaker.js) ─────────────────
export const WH = {
  TUBE_LEN: 46,
  THROAT_Z: -14,
  THROAT_R: 0.6,
  FLARE:    2.6,
  MAX_R:    7.6,
};
WH.THROAT_DEPTH = -WH.THROAT_Z / WH.TUBE_LEN;

const g = n => (Number.isInteger(n) ? n.toFixed(1) : String(n));

// GLSL snippet: radius of the wormhole wall at world-space z.
const WORM_RADIUS = /* glsl */`
  float wormRadius(float z) {
    float l = z - (${g(WH.THROAT_Z)});
    return min(sqrt(${g(WH.THROAT_R)} * ${g(WH.THROAT_R)} + (l * l) / (${g(WH.FLARE)} * ${g(WH.FLARE)})), ${g(WH.MAX_R)});
  }
`;

// ═══════════════════════════════════════════════════════════════════════════
//  Tube membrane — a warped spiral grid forming the wormhole wall
// ═══════════════════════════════════════════════════════════════════════════
export const tubeVertexShader = /* glsl */`
  attribute float aAngle;   // 0..1 around the tube
  attribute float aDepth;   // 0..1 along the tube (0 = near mouth, 1 = far mouth)

  uniform sampler2D uFreqTex;
  uniform float uTime;
  uniform float uTravel;
  uniform float uEnergy;
  uniform float uBeat;

  varying float vDepth;
  varying float vAngle;
  varying float vAmp;
  varying float vThroat;

  ${WORM_RADIUS}

  void main() {
    float d = aDepth;
    float z = -d * ${g(WH.TUBE_LEN)};

    // FFT sampled around the ring, mirrored so there is no seam at the wrap.
    float fftCoord = 1.0 - abs(aAngle * 2.0 - 1.0);
    float amp = texture2D(uFreqTex, vec2(fftCoord, 0.5)).r;

    float baseR = wormRadius(z);
    float ripple = sin(d * 22.0 - uTravel * 2.4) * 0.03 * baseR;
    float safe   = smoothstep(0.0, 0.24, d);           // don't distort right at the lens
    float r = baseR + ripple + amp * (0.4 + uEnergy * 1.3) * safe
            + uBeat * 0.2 * safe;

    // Twist grows with depth → the whole tube reads as a spiral being wound in.
    float theta = aAngle * 6.2831853
                + uTime * 0.18
                + d * (1.8 + uEnergy * 1.4)
                - uTravel * 0.3;

    // Smooth low-frequency lateral drift of the whole throat (spacetime sway).
    float sway = 1.0 - d;
    vec2 drift = vec2(sin(uTime * 0.5 + d * 2.0), cos(uTime * 0.43 + d * 2.0)) * 0.12 * sway;
    vec3 pos;
    pos.x = cos(theta) * r + drift.x;
    pos.y = sin(theta) * r + drift.y;
    pos.z = z;

    float throatDepth = ${g(WH.THROAT_DEPTH)};
    vThroat = 1.0 - smoothstep(0.0, 0.16, abs(d - throatDepth));
    vDepth  = d;
    vAngle  = aAngle;
    vAmp    = amp;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const tubeFragmentShader = /* glsl */`
  precision highp float;

  varying float vDepth;
  varying float vAngle;
  varying float vAmp;
  varying float vThroat;

  uniform float uTime;
  uniform float uTravel;
  uniform float uEnergy;
  uniform float uBeat;
  uniform vec3  uColorA;
  uniform vec3  uColorB;

  float line(float x, float w) {
    float f = abs(fract(x) - 0.5);
    return smoothstep(w, 0.0, f);
  }

  void main() {
    // Rushing concentric rings carry the depth; twisting spokes add the spiral.
    float rings  = line(vDepth * 46.0 - uTravel * 5.0, 0.09);
    float spokes = line(vAngle * 16.0 + vDepth * 10.0 - uTravel * 1.4, 0.04);
    float grid   = max(rings, spokes * 0.55);

    // Near rings read as colour A, deep rings as colour B → a depth gradient.
    vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 0.55, vDepth));
    col = mix(col, vec3(1.0), vThroat * 0.7);

    float fill = 0.03 + vAmp * 0.10;
    float glow = fill + grid * (0.8 + uEnergy * 1.6 + uBeat * 0.7);
    glow *= 0.7 + vThroat * 1.9;                        // brightest near the throat
    glow *= 1.0 - smoothstep(0.68, 0.98, vDepth);       // dissolve into the far side
    glow *= smoothstep(0.0, 0.16, vDepth);              // soft at the lens edge

    gl_FragColor = vec4(col * glow * 1.25, clamp(glow, 0.0, 1.0));
  }
`;

// ═══════════════════════════════════════════════════════════════════════════
//  Infalling matter — particles spiralling down the wall toward the throat
// ═══════════════════════════════════════════════════════════════════════════
export const dustVertexShader = /* glsl */`
  attribute float aSeed;      // 0..1 unique
  attribute float aArm;       // spiral-arm offset 0..1
  attribute float aScatter;   // radial jitter 0..1

  uniform float uTime;
  uniform float uEnergy;
  uniform float uBeat;

  varying float vFade;
  varying float vHot;

  ${WORM_RADIUS}

  void main() {
    float speed = 0.04 + uEnergy * 0.2 + uBeat * 0.03;
    float t = fract(aSeed + uTime * speed);            // 0 = mid-tube → 1 = throat

    float throatDepth = ${g(WH.THROAT_DEPTH)};
    float d = mix(0.13, throatDepth * 0.99, t);        // start well past the lens
    float z = -d * ${g(WH.TUBE_LEN)};

    float wall = wormRadius(z);
    // Ride just inside the wall, then peel inward toward the throat.
    float r = wall * (0.62 + 0.30 * aScatter) * (1.0 - t * t * 0.55);

    // Tight spiral arms that wind up as they near the throat.
    float ang = aArm * 6.2831853 + t * (7.0 + uEnergy * 5.0) + uTime * 0.5;
    vec3 pos = vec3(cos(ang) * r, sin(ang) * r, z);
    pos.xy += vec2(sin(aSeed * 40.0 + uTime), cos(aSeed * 37.0 + uTime)) * 0.05;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = mix(1.0, 3.6, t * t) * (240.0 / -mv.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 5.0);

    vFade = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.86, 1.0, t));
    vHot  = t;
  }
`;

export const dustFragmentShader = /* glsl */`
  precision highp float;

  varying float vFade;
  varying float vHot;

  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform float uEnergy;

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float dsq = dot(uv, uv);
    if (dsq > 1.0) discard;

    vec3 col = mix(uColorA, uColorB, vHot);
    col = mix(col, vec3(1.0), vHot * vHot * 0.9);       // white-hot at the throat

    float core  = 1.0 - smoothstep(0.0, 1.0, dsq);
    float alpha = core * vFade * (0.32 + uEnergy * 0.7 + vHot * 0.5);
    gl_FragColor = vec4(col * (0.6 + vHot * 1.6), alpha);
  }
`;

// ═══════════════════════════════════════════════════════════════════════════
//  Einstein ring — the bright lensed circle around the throat
// ═══════════════════════════════════════════════════════════════════════════
export const ringVertexShader = /* glsl */`
  varying float vR;   // 0 at inner edge → 1 at outer edge
  uniform float uInner;
  uniform float uOuter;

  void main() {
    float rad = length(position.xy);
    vR = clamp((rad - uInner) / (uOuter - uInner), 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const ringFragmentShader = /* glsl */`
  precision highp float;

  varying float vR;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uBeat;
  uniform vec3  uColorA;
  uniform vec3  uColorB;

  void main() {
    // A crisp lensed ring hugging the inner edge, with only a faint outward bleed.
    float band = smoothstep(0.10, 0.0, abs(vR - 0.09));
    float halo = pow(1.0 - vR, 3.5) * 0.22;
    float shimmer = 0.8 + 0.2 * sin(uTime * 5.0 + vR * 36.0);

    float i = (band * 1.5 + halo) * shimmer * (0.9 + uEnergy * 1.0 + uBeat * 0.9);
    vec3 col = mix(vec3(1.0), mix(uColorA, uColorB, vR), 0.5);
    gl_FragColor = vec4(col * i, clamp(i, 0.0, 1.0));
  }
`;

// ═══════════════════════════════════════════════════════════════════════════
//  Singularity glow — a camera-facing radial burst at the throat
// ═══════════════════════════════════════════════════════════════════════════
export const coreVertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const coreFragmentShader = /* glsl */`
  precision highp float;

  varying vec2 vUv;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uBeat;
  uniform vec3  uColorB;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    float pulse = 0.9 + uEnergy * 0.5 + uBeat * 0.4;
    float centre = 1.0 - smoothstep(0.0, 0.5 * pulse, r);
    float coreDot = pow(centre, 1.6);                    // solid white centre
    float halo    = pow(1.0 - r, 2.6) * (0.6 + uEnergy); // soft aura

    // Faint rotating rays for a lensed shimmer.
    float ang  = atan(p.y, p.x);
    float rays = 0.14 * pow(1.0 - r, 2.0) * (0.5 + 0.5 * sin(ang * 10.0 + uTime * 2.0));

    float i = coreDot * 3.0 + halo * 1.3 + rays;
    vec3 col = mix(uColorB, vec3(1.0), min(coreDot + 0.4, 1.0));
    gl_FragColor = vec4(col * i, clamp(i, 0.0, 1.0));
  }
`;

// ═══════════════════════════════════════════════════════════════════════════
//  Far-side starfield — seen through the throat, slowly swirling (lensing hint)
// ═══════════════════════════════════════════════════════════════════════════
export const starVertexShader = /* glsl */`
  attribute float aTwinkle;

  uniform float uTime;
  uniform float uEnergy;

  varying float vTw;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.0 + aTwinkle * 2.2) * (200.0 / -mv.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 4.0);
    vTw = 0.55 + 0.45 * sin(uTime * (1.0 + aTwinkle * 3.0) + aTwinkle * 30.0);
  }
`;

export const starFragmentShader = /* glsl */`
  precision highp float;

  varying float vTw;
  uniform vec3  uColorB;
  uniform float uEnergy;

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float dsq = dot(uv, uv);
    if (dsq > 1.0) discard;
    float core = 1.0 - smoothstep(0.0, 1.0, dsq);
    vec3 col = mix(vec3(1.0), uColorB, 0.4);
    gl_FragColor = vec4(col * (0.6 + uEnergy), core * vTw * 0.9);
  }
`;
