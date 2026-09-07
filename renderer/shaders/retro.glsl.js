// Global "retro" post-processing pass — a CRT / synthwave grade applied on top
// of whichever visualisation is running. Everything is scaled by uAmount so the
// effect can be ramped smoothly in and out (uAmount = 0 is an exact passthrough).

export const retroVertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

export const retroFragmentShader = /* glsl */`
  varying vec2 vUv;

  uniform sampler2D uScene;
  uniform vec2  uResolution;
  uniform float uTime;
  uniform float uBeat;
  uniform float uEnergy;
  uniform float uAmount;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // Bulge the frame outward like a CRT tube.
  vec2 curve(vec2 uv) {
    uv = uv * 2.0 - 1.0;
    vec2 off = abs(uv.yx) / vec2(5.0, 4.0);
    uv += uv * off * off;
    return uv * 0.5 + 0.5;
  }

  void main() {
    vec2 uv = mix(vUv, curve(vUv), uAmount);

    // Anything pulled past the tube edge reads as black bezel.
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    vec2 dir  = uv - 0.5;
    vec2 px   = 1.0 / uResolution;

    // Chromatic aberration: subtle in the centre, wider at the edges, and it
    // kicks on every beat.
    float ca     = (0.0016 + uEnergy * 0.0022 + uBeat * 0.0045) * uAmount;
    float caEdge = 1.0 + dot(dir, dir) * 2.4;
    float r = texture2D(uScene, uv + dir * ca * caEdge).r;
    float g = texture2D(uScene, uv).g;
    float b = texture2D(uScene, uv - dir * ca * caEdge).b;
    vec3 col = vec3(r, g, b);

    // Phosphor bleed / cheap bloom.
    vec3 bleed = texture2D(uScene, uv + vec2(px.x * 1.5, 0.0)).rgb
               + texture2D(uScene, uv - vec2(px.x * 1.5, 0.0)).rgb
               + texture2D(uScene, uv + vec2(0.0, px.y * 1.5)).rgb
               + texture2D(uScene, uv - vec2(0.0, px.y * 1.5)).rgb;
    col += bleed * 0.07 * uAmount;

    // Horizontal scanlines, drifting slowly upward.
    float scan = 0.5 + 0.5 * sin(uv.y * uResolution.y * 1.0 - uTime * 14.0);
    col *= mix(1.0, 0.70 + 0.30 * scan, uAmount);

    // Aperture-grille RGB triads across every 3 physical pixels.
    float slot = mod(gl_FragCoord.x, 3.0);
    vec3 grille = vec3(0.85);
    if (slot < 1.0)       grille.r = 1.15;
    else if (slot < 2.0)  grille.g = 1.15;
    else                  grille.b = 1.15;
    col *= mix(vec3(1.0), grille, uAmount * 0.7);

    // Rolling brightness bar sweeping down the screen.
    float roll = fract(uv.y - uTime * 0.12);
    col += smoothstep(0.965, 1.0, roll) * 0.05 * uAmount;

    // Colour quantisation for that limited-palette banding.
    float levels = mix(255.0, 28.0, uAmount);
    col = floor(col * levels + 0.5) / levels;

    // Punch saturation a touch and tilt toward magenta/cyan.
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(luma), col, 1.0 + 0.28 * uAmount);
    col *= mix(vec3(1.0), vec3(1.05, 0.97, 1.10), uAmount);

    // Vignette.
    float vig = 1.0 - dot(dir, dir) * (1.15 * uAmount);
    col *= clamp(vig, 0.0, 1.0);

    // Film grain + mains-hum flicker.
    float noise = hash(uv * uResolution + fract(uTime) * 97.0);
    col += (noise - 0.5) * 0.055 * uAmount;
    col *= 1.0 - 0.028 * uAmount * (0.5 + 0.5 * sin(uTime * 50.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;
