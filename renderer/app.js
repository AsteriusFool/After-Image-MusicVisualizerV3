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
const dropZone   = document.getElementById('drop-overlay');
const fileInput  = document.getElementById('audio-file-input');

const ui = new DockUI({
  onSource:    handleSourceChange,
  onViz:       mode => visualizer.setViz(mode),
  onTheme:     name => visualizer.setTheme(name),
  onRetro:     on => visualizer.setRetro(on),
  onPlayPause: togglePlayPause,
});

async function togglePlayPause() {
  if (!analyzer.isConnected) return;
  const isPlaying = await analyzer.togglePlay();
  ui.setPlayState(isPlaying, true);
  ui._flashHint(isPlaying ? '<b>Playing</b>' : '<b>Paused</b>');
}

// ── Audio source management ──────────────────────────────────────────────────
async function handleSourceChange(kind) {
  if (kind === 'file') {
    fileInput?.click();
    return;
  }
  startCapture(kind);
}

async function startCapture(kind) {
  const isSystem = kind === 'system';
  ui.setStatus(isSystem ? 'Requesting system audio…' : 'Requesting microphone…', 'pending');
  try {
    const stream = await (isSystem ? captureSystemAudio() : captureMicrophone());
    analyzer.connect(stream);
    ui.setStatus(isSystem ? 'System audio' : 'Microphone', 'active');
    ui.setPlayState(false, false);
  } catch (err) {
    ui.setStatus('Error: ' + err.message, 'error');
    ui.setPlayState(false, false);
    console.error(`[app] capture (${kind}) failed:`, err);
  }
}

// ── Drag & Drop / Local File Playback ─────────────────────────────────────────
function playLocalFile(file) {
  if (!file) return;
  const isAudio = file.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac|webm)$/i.test(file.name);
  if (!isAudio) {
    ui.setStatus('Please drop a valid audio file (MP3, WAV, FLAC, OGG)', 'error');
    return;
  }

  const cleanName = file.name.replace(/\.[^/.]+$/, '');
  ui.setStatus(`Loading ${cleanName}…`, 'pending');
  analyzer.loadFile(file).then(() => {
    ui.setStatus(`♫ ${cleanName}`, 'active');
    ui.syncSource('file');
    ui.setPlayState(true, true);
  }).catch(err => {
    ui.setStatus('Playback error: ' + err.message, 'error');
    ui.setPlayState(false, false);
    console.error('[app] file playback failed:', err);
  });
}

fileInput?.addEventListener('change', e => {
  if (e.target.files && e.target.files[0]) {
    playLocalFile(e.target.files[0]);
  }
});

// Window Drag & Drop handlers
window.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  dropZone?.classList.add('active');
});

window.addEventListener('dragleave', e => {
  if (e.relatedTarget === null || e.clientY <= 0 || e.clientX <= 0) {
    dropZone?.classList.remove('active');
  }
});

window.addEventListener('drop', e => {
  e.preventDefault();
  dropZone?.classList.remove('active');
  const file = e.dataTransfer?.files?.[0];
  if (file) playLocalFile(file);
});

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

  const isConn = analyzer.isConnected;
  const bins   = isConn ? analyzer.bins   : EMPTY_BINS;
  const energy = isConn ? analyzer.energy : 0;
  const beat   = isConn ? analyzer.beat   : false;
  const details = {
    kick:     isConn ? analyzer.kick     : 0,
    snare:    isConn ? analyzer.snare    : 0,
    hihat:    isConn ? analyzer.hihat    : 0,
    bass:     isConn ? analyzer.bass     : 0,
    mid:      isConn ? analyzer.mid      : 0,
    treble:   isConn ? analyzer.treble   : 0,
    energy:   isConn ? analyzer.energy   : 0,
    bpm:      isConn ? analyzer.bpm      : 120,
    phase:    isConn ? analyzer.phase    : 0,
    metadata: analyzer.metadata,
  };

  visualizer.render(bins, energy, beat, details);
  ui.react(bins, energy, beat, details);
}

loop();
