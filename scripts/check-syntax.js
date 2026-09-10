'use strict';
/**
 * Syntax-checks every listed file individually.
 *
 * The previous "test" script ran `node --check a.js b.js c.js ...` as one
 * command — but `node --check` only validates the FIRST file given; every
 * other filename is treated as argv for that first file's (unexecuted)
 * script, not as another file to check. So every file after main.js in the
 * old list was silently never being validated, despite `npm test` reporting
 * success. This runs `node --check` once per file so a real syntax error in
 * any of them actually fails the build.
 */
const { execFileSync } = require('child_process');

const FILES = [
  'main.js',
  'preload.js',
  'server.js',
  'scripts/postinstall.js',
  'scripts/check-syntax.js',
  'renderer/audio-analyzer.js',
  'renderer/visualizer.js',
  'renderer/app.js',
  'renderer/ui.js',
  'renderer/exc3-typography.js',
  'renderer/viz/exc3.js',
  'renderer/shaders/exc3.glsl.js',
  'renderer/viz/impulse.js',
  'renderer/viz/custom.js',
  'renderer/shaders/impulse.glsl.js',
  'renderer/viz/bars.js',
  'renderer/viz/orb.js',
  'renderer/viz/particles.js',
  'renderer/viz/tunnel.js',
  'renderer/shader-library.js',
];

let failed = 0;
for (const file of FILES) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  } catch (_) {
    failed++;
    console.error(`[check-syntax] FAILED: ${file}`);
  }
}

if (failed > 0) {
  console.error(`[check-syntax] ${failed} of ${FILES.length} file(s) failed syntax check.`);
  process.exit(1);
}
console.log(`[check-syntax] ${FILES.length} files OK.`);
