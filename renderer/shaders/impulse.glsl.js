// Bass-impulse physics field — faceted shards knocked outward by kick hits,
// spring back to their resting shell, and tumble to rest between beats.
export const vertexShader = /* glsl */`
  attribute float aColorMix;
  uniform float uGlow;

  varying float vMix;
  varying float vFaceLight;

  void main() {
    vMix = aColorMix;
    // Cheap directional shading keeps the low-poly facets legible without scene lights.
    vFaceLight = 0.55 + abs(normal.y) * 0.30 + abs(normal.x) * 0.15;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const fragmentShader = /* glsl */`
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uGlow;

  varying float vMix;
  varying float vFaceLight;

  void main() {
    vec3 color = mix(uColorA, uColorB, vMix);
    color *= vFaceLight * (0.65 + uGlow * 0.9);
    gl_FragColor = vec4(color, 1.0);
  }
`;
