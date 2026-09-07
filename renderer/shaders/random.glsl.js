export const SHAPE_COUNT = 18;
export function getMorphState(elapsed) {
  const seconds = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const current = Math.floor(seconds / 10) % SHAPE_COUNT;
  const progress = Math.max(0, Math.min(1, ((seconds % 10) - 7) / 3));
  return { current, next: (current + 1) % SHAPE_COUNT,
    blend: progress * progress * (3 - 2 * progress) };
}

export const vertexShader = /* glsl */`
  attribute vec4 aSeed;

  uniform sampler2D uFreqTex;
  uniform float uTime;
  uniform float uShape;
  uniform float uNextShape;
  uniform float uMorph;
  uniform float uBass;
  uniform float uMids;
  uniform float uTreble;
  uniform float uEnergy;
  uniform float uBeat;

  varying float vEnergy;
  varying float vPattern;

  vec2 shapePoint(float kind, vec4 seed) {
    float angle = seed.x * 6.2832;
    float radius = sqrt(seed.y);

    // 0: Disk
    if (kind < 0.5) {
      return vec2(cos(angle), sin(angle)) * radius * 4.0;
    }
    // 1: Rectangle
    if (kind < 1.5) {
      return (seed.xy - 0.5) * vec2(7.6, 5.8);
    }
    // 2: Triangle
    if (kind < 2.5) {
      float height = seed.y * 5.8 - 2.9;
      float width = max(0.08, (height + 2.9) / 5.8 * 7.0);
      return vec2((seed.x - 0.5) * width, height);
    }
    // 3: Diamond
    if (kind < 3.5) {
      vec2 direction = vec2(cos(angle), sin(angle));
      float diamondScale = max(abs(direction.x), abs(direction.y));
      return direction / diamondScale * radius * 4.1;
    }
    // 4: Star (5-point)
    if (kind < 4.5) {
      float starRadius = 2.15 + cos(angle * 5.0) * 1.55;
      return vec2(cos(angle), sin(angle)) * radius * starRadius;
    }
    // 5: Galaxy spiral (2 arms)
    if (kind < 5.5) {
      float arm = step(0.5, seed.z) * 3.14159;
      float r = radius * 4.2;
      float t = seed.x * 6.2832 + r * 0.9 + arm;
      return vec2(cos(t), sin(t)) * r;
    }
    // 6: Polar rose (6 petals)
    if (kind < 6.5) {
      float r = abs(cos(angle * 3.0));
      return vec2(cos(angle), sin(angle)) * r * radius * 4.5;
    }
    // 7: Hexagon
    if (kind < 7.5) {
      float sector = floor(seed.x * 6.0);
      float a1 = sector * 1.0472;
      float a2 = a1 + 1.0472;
      vec2 p1 = vec2(cos(a1), sin(a1)) * 3.8;
      vec2 p2 = vec2(cos(a2), sin(a2)) * 3.8;
      return mix(mix(p1, p2, fract(seed.x * 6.0)), vec2(0.0), seed.z * 0.7);
    }
    // 8: Cross
    if (kind < 8.5) {
      float isVert = step(0.5, seed.z);
      float along = (seed.x - 0.5) * 7.5;
      float perp  = (seed.y - 0.5) * 1.5;
      return isVert > 0.5 ? vec2(perp, along) : vec2(along, perp);
    }
    // 9: Heart
    if (kind < 9.5) {
    float ht = seed.x * 6.2832;
    float sint = sin(ht);
    float hx =  16.0 * sint * sint * sint;
    float hy = -(13.0 * cos(ht) - 5.0 * cos(2.0*ht) - 2.0 * cos(3.0*ht) - cos(4.0*ht));
    return vec2(hx, hy) * (0.13 + seed.y * 0.10);
    }
    // 10: Woven infinity ribbon
    if (kind < 10.5) {
      float w = (seed.y - 0.5) * 0.42;
      float d = 1.0 + pow(sin(angle), 2.0);
      return vec2(4.8 * cos(angle), 4.8 * sin(angle) * cos(angle)) / d
           + w * vec2(cos(angle), sin(angle));
    }
    // 11: Butterfly curve, layered wings
    if (kind < 11.5) {
      float r = exp(cos(angle)) - 2.0 * cos(4.0 * angle)
              - pow(sin(angle / 12.0), 5.0);
      return vec2(sin(angle), cos(angle)) * r * (0.8 + seed.y * 0.25);
    }
    // 12: Nautilus spiral with chamber ribs
    if (kind < 12.5) {
      float t = seed.x * 18.849556;
      float r = 0.18 * exp(t * 0.16);
      float chamber = 0.78 + 0.22 * cos(t * 9.0);
      return vec2(cos(t), sin(t)) * r * mix(chamber, 1.0, seed.y);
    }
    // 13: Six branching crystal arms
    if (kind < 13.5) {
      float arm = floor(seed.z * 6.0) * 1.047198;
      float branch = floor(seed.x * 4.0);
      float side = seed.w < 0.5 ? -1.0 : 1.0;
      float along = branch < 0.5 ? seed.y * 3.8 : branch * 0.85 + seed.y * 0.65;
      float across = branch < 0.5 ? (seed.w - 0.5) * 0.08 : side * seed.y * (1.2 - branch * 0.2);
      return vec2(cos(arm) * along - sin(arm) * across,
                  sin(arm) * along + cos(arm) * across);
    }
    // 14: Hypotrochoid / seven-lobed spirograph
    if (kind < 14.5) {
      float t = angle * 3.0;
      vec2 p = 2.2 * vec2(cos(t), sin(t)) + 1.35 * vec2(cos(t * 2.333333), -sin(t * 2.333333));
      return p * (0.92 + seed.y * 0.08);
    }
    // 15: Cosmic eye with a separate iris
    if (kind < 15.5) {
      if (seed.z < 0.35) {
        return vec2(cos(angle), sin(angle)) * (0.85 + seed.y * 0.25);
      }
      float x = seed.x * 2.0 - 1.0;
      float side = seed.z < 0.675 ? -1.0 : 1.0;
      return vec2(x * 4.1, side * (1.0 - x * x) * 1.8 * (0.92 + seed.y * 0.08));
    }
    // 16: Three interlocking orbital loops
    if (kind < 16.5) {
      float turn = floor(seed.z * 3.0) * 2.094395;
      vec2 p = vec2(cos(angle) * 3.8, sin(angle) * 1.25) * (0.95 + seed.y * 0.05);
      return vec2(p.x * cos(turn) - p.y * sin(turn), p.x * sin(turn) + p.y * cos(turn));
    }
    // 17: Braided harmonic lattice
    return vec2(sin(angle * 3.0 + 1.570796), sin(angle * 4.0)) * 3.2
         + (seed.y - 0.5) * 0.16 * vec2(cos(angle), sin(angle));

  }

  void main() {
    // Seven seconds holding, then three seconds easing into the next form.
    vec2 formed = mix(shapePoint(uShape, aSeed), shapePoint(uNextShape, aSeed), uMorph);
    vec3 pos = vec3(formed, position.z * 0.22 + (aSeed.z - 0.5) * 1.2);
    // Coherent ripples follow the form, keeping silhouettes readable.
    float radius = length(formed);
    vec2 radial = formed / max(radius, 0.001);
    vec2 tangent = vec2(-radial.y, radial.x);
    float angle = atan(formed.y + 0.0001, formed.x + 0.0001);
    float ripple = sin(radius * 3.5 - uTime * 7.0 + angle * 3.0);
    float shimmer = sin(uTime * 22.0 + aSeed.w * 6.2832);
    float localAmp = texture2D(uFreqTex, vec2(0.002 + aSeed.x * aSeed.x * 0.48, 0.5)).r;

    // Bass expands the whole form; beats add a short, decaying push.
    pos.xy *= 1.04 + uBass * 0.08 + uEnergy * 0.03 + uBeat * 0.04;
    pos.xy += radial * ripple * uMids * 0.07;
    pos.xy += tangent * sin(radius * 2.0 - uTime * 4.0) * uMids * 0.035;
    pos.xy += radial * shimmer * uTreble * localAmp * 0.02;
    pos.z += ripple * uMids * 0.10 + shimmer * uTreble * 0.025;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;
    gl_PointSize = clamp((0.8 + localAmp * 0.5 + uTreble * 0.25 + uBeat * 0.3) * (24.0 / max(0.1, -mvPos.z)), 1.0, 6.0);
    vEnergy = clamp(localAmp * 0.5 + uEnergy * 0.45 + uTreble * 0.3, 0.0, 1.0);
    vPattern = clamp(aSeed.x * 0.65 + localAmp * 0.2 + uMids * 0.15, 0.0, 1.0);
  }
`;

export const fragmentShader = /* glsl */`
  varying float vEnergy;
  varying float vPattern;

  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uBeat;

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float shape = dot(uv, uv);
    if (shape > 1.0) discard;

    vec3 color = mix(uColorA, uColorB, vPattern);
    color = mix(color, vec3(1.0), clamp(uBeat * 0.35 + vEnergy * 0.12, 0.0, 0.5));
    float alpha = (0.22 + vEnergy * 0.48 + uBeat * 0.12) * (1.0 - smoothstep(0.55, 1.0, shape));
    gl_FragColor = vec4(color * (0.75 + vEnergy * 1.25 + uBeat * 0.25), alpha);
  }
`;
