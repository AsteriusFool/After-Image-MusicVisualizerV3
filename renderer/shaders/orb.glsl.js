// Flowing circular membrane inspired by the supplied video reference.
export const vertexShader = /* glsl */`
  varying vec2 vPoint;
  void main() {
    vPoint = position.xy;
    vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    gl_Position = projectionMatrix * (center + vec4(position.xy, 0.0, 0.0));
  }
`;

export const fragmentShader = /* glsl */`
  uniform sampler2D uSpectrum;
  uniform float uTime;
  uniform float uBass;
  uniform float uEnergy;
  uniform float uBeat;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec2 vPoint;

  float spectrum(float index) {
    index = clamp(index, 0.0, 127.0);
    float low = floor(index);
    return mix(texture2D(uSpectrum, vec2((low + 0.5) / 128.0, 0.5)).r,
               texture2D(uSpectrum, vec2((min(low + 1.0, 127.0) + 0.5) / 128.0, 0.5)).r,
               fract(index));
  }

  void main() {
    float r = length(vPoint);
    float angle = atan(vPoint.y, vPoint.x + 0.000001);
    // Low and middle frequencies occupy the entire circumference.
    float phase = 0.5 + 0.5 * sin(angle + uTime * 0.18);
    float amp = spectrum(phase * phase * 48.0);
    float body = clamp(uBass * 0.55 + uEnergy * 2.0, 0.0, 1.0);
    float wave = sin(angle * 3.0 + uTime * 1.1)
               + 0.45 * sin(angle * 5.0 - uTime * 0.72);
    float fold = pow(0.5 + 0.5 * sin(angle * 4.0 - uTime * 0.85), 3.0);
    // Most movement is in the contour itself, not a uniform scale pulse.
    float base = 2.12 + uBass * 0.055 + uBeat * 0.025;
    float contour = base + wave * body * 0.10
                  - fold * (body * 0.20 + amp * 0.20)
                  + (amp - body * 0.5) * 0.08;
    float width = 0.045 + body * 0.02 + fold * amp * 0.075;
    float distanceToRim = abs(r - contour);
    float aa = max(fwidth(distanceToRim), 0.002);
    float rim = 1.0 - smoothstep(width - aa, width + aa, distanceToRim);
    float glow = exp(-distanceToRim / 0.075) * 0.28
               + exp(-distanceToRim / 0.18) * body * 0.08;
    vec3 tint = mix(uColorA, uColorB, 0.32 + 0.16 * sin(angle + uTime * 0.12));
    vec3 bright = mix(tint, vec3(1.0), 0.72);
    vec3 light = bright * rim * 1.15 + tint * glow;

    // Project a rotating, warped latitude/longitude lattice onto the inner disk.
    // This gives the dots a curved cloth/sphere appearance instead of random dust.
    vec2 p = vPoint / max(contour - width, 0.1);
    float pr = length(p);
    vec2 warped = p;
    warped.x += sin(p.y * 3.5 + uTime * 0.7) * body * 0.10 * (1.0 - min(pr, 1.0));
    float depth = sqrt(max(0.0, 1.0 - dot(warped, warped)));
    vec3 surface = vec3(warped, depth);
    float turn = uTime * 0.28;
    surface.xz = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * surface.xz;
    float longitude = atan(surface.x, surface.z) / 6.2831853;
    float latitude = asin(clamp(surface.y, -1.0, 1.0)) / 3.14159265;
    vec2 grid = vec2(longitude * 88.0, latitude * 52.0);
    vec2 cell = fract(grid + 0.5) - 0.5;
    // Screen-space dot size avoids large blobs near the projection's poles.
    vec2 pixelCell = cell / max(fwidth(grid), vec2(0.001));
    float dots = 1.0 - smoothstep(0.6, 1.4, length(pixelCell));
    float veil = smoothstep(0.08, 0.48, body);
    float mask = 1.0 - smoothstep(0.96, 1.0, pr);
    float ripple = 0.65 + 0.35 * sin(p.x * 4.0 + p.y * 3.0 - uTime);
    light += mix(tint, vec3(1.0), 0.5) * dots * mask * veil * ripple * 0.75;
    light *= 0.9 + uBeat * 0.10;
    gl_FragColor = vec4(light, 1.0);
  }
`;
