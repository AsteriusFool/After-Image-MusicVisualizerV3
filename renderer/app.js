'use strict';
/**
 * app.js — entry point.
 * Wires together: dock UI → audio capture → FFT analysis → Three.js visualizer.
 */

import { captureSystemAudio, captureMicrophone } from './audio-capture.js';
import { AudioAnalyzer }                          from './audio-analyzer.js';
import { Visualizer }                             from './visualizer.js';
import { DockUI }                                 from './ui.js';
import { loadLastSource }                         from './shader-library.js';

// ── Initialise core objects ──────────────────────────────────────────────────
const canvas     = document.getElementById('canvas');
const analyzer   = new AudioAnalyzer();
const visualizer = new Visualizer(canvas);
const dropZone   = document.getElementById('drop-overlay');
const fileInput  = document.getElementById('audio-file-input');

// Restore whatever Live Shader was last applied, across app restarts — the
// dock's Live Shader preset picks this up automatically via getCustomShaderSource().
const lastShaderSource = loadLastSource();
if (lastShaderSource) visualizer.setCustomShader(lastShaderSource);

const ui = new DockUI({
  onSource:       handleSourceChange,
  onViz:          mode => visualizer.setViz(mode),
  onTheme:        name => visualizer.setTheme(name),
  onRetro:        on => visualizer.setRetro(on),
  onPlayPause:    togglePlayPause,
  onPin:          togglePin,
  onRecordToggle: toggleRecording,
  onCustomMode:   () => ui.setShaderSource(visualizer.getCustomShaderSource()),
  onShaderApply:  src => visualizer.setCustomShader(src),
  onShaderReset:  () => {
    const result = visualizer.resetCustomShader();
    ui.setShaderSource(visualizer.getCustomShaderSource());
    return result;
  },
});

async function togglePlayPause() {
  if (!analyzer.isConnected) return;
  const isPlaying = await analyzer.togglePlay();
  ui.setPlayState(isPlaying, true);
  ui._flashHint(isPlaying ? '<b>Playing</b>' : '<b>Paused</b>');
}

// ── Always-on-top pin (for overlay-style use while streaming) ────────────────
async function togglePin() {
  return window.electronAPI?.windowAlwaysOnTopToggle?.();
}

// ── Global (OS-level) hotkeys + tray actions, routed to the same logic as the
//    on-screen keyboard shortcuts ─────────────────────────────────────────────
const unsubscribeGlobalShortcut = window.electronAPI?.onGlobalShortcut?.(action => {
  switch (action) {
    case 'play-pause': togglePlayPause(); break;
    case 'next-viz':   ui.cycleViz(1); break;
    case 'prev-viz':   ui.cycleViz(-1); break;
    case 'next-color': ui.cycleTheme(1); break;
    default: break;
  }
});
window.addEventListener('beforeunload', () => unsubscribeGlobalShortcut?.());

// ── Session recording — canvas + tapped audio → a downloadable video file ────
let mediaRecorder = null;
let recordedChunks = [];

function pickRecorderMimeType() {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    return;
  }
  if (!analyzer.isConnected) {
    ui._flashHint('Choose an audio source before recording.');
    return;
  }
  try {
    const videoStream = canvas.captureStream(30);
    const audioStream = analyzer.getRecordingStream();
    const tracks = [...videoStream.getVideoTracks()];
    if (audioStream) tracks.push(...audioStream.getAudioTracks());
    const combined = new MediaStream(tracks);
    const mimeType = pickRecorderMimeType();

    recordedChunks = [];
    mediaRecorder = new MediaRecorder(combined, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      ui.setRecordingState(false);
      const blob = new Blob(recordedChunks, { type: mimeType || 'video/webm' });
      recordedChunks = [];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.href = url;
      a.download = `afterimage-${stamp}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      ui._flashHint('Recording <b>saved</b>');
    };
    mediaRecorder.start();
    ui.setRecordingState(true);
    ui._flashHint('Recording <b>started</b>');
  } catch (err) {
    console.error('[app] recording failed:', err);
    ui._flashHint('Recording is unavailable in this session.');
    ui.setRecordingState(false);
  }
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
document.addEventListener('keydown', async e => {
  if (e.key === 'F11') {
    e.preventDefault();
    if (window.electronAPI?.windowFullscreenToggle) {
      const isFs = await window.electronAPI.windowFullscreenToggle();
      if (typeof isFs === 'boolean') {
        document.body.classList.toggle('is-fullscreen', isFs);
        const fsBtn = document.getElementById('btn-fullscreen');
        if (fsBtn) fsBtn.setAttribute('aria-pressed', String(isFs));
      }
    } else {
      ui._toggleFullscreen();
    }
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
    section:  isConn ? analyzer.section  : 'intro',
    metadata: analyzer.metadata,
  };

  // Auto-Director: on a detected drop, hand the visualizer off to the next preset.
  if (ui.autoDirectorOn && isConn && analyzer.sectionChanged && analyzer.section === 'drop') {
    ui.cycleViz(1);
  }

  visualizer.render(bins, energy, beat, details);
  ui.react(bins, energy, beat, details);
  ui.setSectionTag(isConn ? analyzer.section : null);
}

loop();
