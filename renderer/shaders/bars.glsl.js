// Solid, segmented spectrum bars with shaded sides and luminous tips.
export const vertexShader = /* glsl */`
  attribute float aLevel;
  attribute float aPhase;
  uniform float uMaxH;
  uniform float uBeat;

  varying float vPhase;
  varying float vHeight;
  varying float vLocalHeight;
  varying float vFaceLight;

  void main() {
    float height = 0.10 + aLevel * uMaxH * (1.0 + uBeat * 0.025);
    vec3 pos = position;
    pos.y *= height;
    vPhase = aPhase;
    vHeight = pos.y;
    vLocalHeight = position.y;
    // Face-specific shading keeps the small cuboids legible without scene lights.
    vFaceLight = normal.y > 0.5 ? 1.0 : (abs(normal.x) > 0.5 ? 0.72 : 0.48);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
  }
`;

export const fragmentShader = /* glsl */`
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uBeat;
  varying float vPhase;
  varying float vHeight;
  varying float vLocalHeight;
  varying float vFaceLight;

  void main() {
    vec3 color = mix(uColorA, uColorB, clamp(vPhase * 0.55 + vLocalHeight * 0.45, 0.0, 1.0));
    // Anti-aliased dark separators evoke LED meters without adding geometry.
    float cell = vHeight / 0.18;
    float edge = min(fract(cell), 1.0 - fract(cell));
    float aa = max(fwidth(cell), 0.015);
    float segment = smoothstep(0.045 - aa, 0.045 + aa, edge);
    float tip = smoothstep(0.94, 1.0, vLocalHeight);
    color *= vFaceLight * mix(0.55, 1.0, segment) * (0.65 + vLocalHeight * 0.35);
    color = mix(color, mix(uColorB, vec3(1.0), 0.35), tip * 0.7);
    color *= 1.0 + uBeat * 0.08;
    gl_FragColor = vec4(color, 1.0);
  }
`;
