'use strict';
/**
 * app.js — entry point.
 * Wires together: dock UI → audio capture → FFT analysis → Three.js visualizer.
 */

import { captureSystemAudio, captureMicrophone } from './audio-capture.js';
import { AudioAnalyzer }                          from './audio-analyzer.js';
import { Visualizer }                             from './visualizer.js';
import { DockUI }                                 from './ui.js';

// ── Initialise core objects ──────────────────────────────────────────────────
const canvas     = document.getElementById('canvas');
const analyzer   = new AudioAnalyzer();
const visualizer = new Visualizer(canvas);

const ui = new DockUI({
  onSource: startCapture,
  onViz:    mode  => visualizer.setViz(mode),
  onTheme:  name  => visualizer.setTheme(name),
  onRetro:  on    => visualizer.setRetro(on),
});

// ── Audio source ─────────────────────────────────────────────────────────────
async function startCapture(kind) {
  const isSystem = kind === 'system';
  ui.setStatus(isSystem ? 'Requesting system audio…' : 'Requesting microphone…', 'pending');
  try {
    const stream = await (isSystem ? captureSystemAudio() : captureMicrophone());
    analyzer.connect(stream);
    ui.setStatus(isSystem ? 'System audio' : 'Microphone', 'active');
  } catch (err) {
    ui.setStatus('Error: ' + err.message, 'error');
    console.error(`[app] capture (${kind}) failed:`, err);
  }
}

// ── Keyboard: fullscreen also on F11 ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'F11') {
    e.preventDefault();
    window.electronAPI?.windowFullscreenToggle();
  }
});

// ── Animation loop ───────────────────────────────────────────────────────────
const EMPTY_BINS = new Float32Array(256);

function loop() {
  requestAnimationFrame(loop);

  analyzer.update(ui.sensitivity);

  const bins   = analyzer.isConnected ? analyzer.bins   : EMPTY_BINS;
  const energy = analyzer.isConnected ? analyzer.energy : 0;
  const beat   = analyzer.isConnected ? analyzer.beat   : false;

  visualizer.render(bins, energy, beat);
  ui.react(bins, energy, beat);
}

loop();
