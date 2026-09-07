'use strict';

/**
 * Wraps the Web Audio AnalyserNode with:
 * - Perceptual logarithmic frequency binning across 256 output bins
 * - Equal-loudness / pink noise tilt compensation for rich high-end visibility
 * - Fast-attack, smooth-decay dual envelope ballistics
 * - 3-Band Spectral Flux Transient Engine (Kick 40-120 Hz, Snare 1-3.5 kHz, Treble 5-16 kHz)
 * - Support for both live streams (loopback/mic) and local media elements (MP3/WAV/FLAC)
 */

const FFT_SIZE      = 2048;
const OUT_BINS      = 256;
const SMOOTH_BASE   = 0.45; // lower hardware smoothing for instant transient response
const BEAT_WIN      = 43;   // ~1 s history at 60 fps
const MIN_FREQ      = 24;   // sub-bass floor
const MAX_FREQ      = 18500;// human audible upper ceiling

export class AudioAnalyzer {
  constructor() {
    this._ctx           = null;
    this._analyser      = null;
    this._raw           = null;
    this._sourceNode    = null;
    this._bufferSource  = null;
    this._activeElement = null;
    this._logMap        = null;

    /** Normalised frequency bins, length OUT_BINS. Updated by update(). */
    this.bins   = new Float32Array(OUT_BINS);
    /** Decay envelope values for ballistic smoothing. */
    this._decay = new Float32Array(OUT_BINS);

    /** True when a beat onset is detected. */
    this.beat   = false;
    /** Mean energy across all bins, 0–1. */
    this.energy = 0;

    /** Transient impulse intensities (0–1 with dynamic envelope) */
    this.kick = this.snare = this.hihat = this.bass = this.mid = this.treble = 0;
    this.bpm  = 120.0;
    this.phase = 0.0;
    this._kickTimes = [];
    this._lastKickTime = this._lastSnareTime = this._lastBeatTime = 0;
    this._prevLow = this._prevMid = this._prevHigh = this._prevEnergy = this._lastFrameTime = 0;

    /** Track metadata for typography and HUD overlays */
    this.metadata = {
      title: 'UNTITLED',
      artist: 'AFTERIMAGE',
      elapsed: 0,
      duration: 0,
    };

    this._history      = new Float32Array(BEAT_WIN);
    this._lowHist      = new Float32Array(BEAT_WIN);
    this._midHist      = new Float32Array(BEAT_WIN);
    this._highHist     = new Float32Array(BEAT_WIN);
    this._histIdx      = 0;
  }

  get isConnected() { return this._ctx !== null; }
  get audioElement() { return this._activeElement; }
  get isPlaying() { return this._ctx ? this._ctx.state === 'running' : false; }
  get isPaused() { return this._ctx ? this._ctx.state === 'suspended' : false; }

  /** Toggle play/pause state for local file playback. Returns true if playing, false if paused. */
  async togglePlay() {
    if (!this._ctx) return false;
    if (this._ctx.state === 'running') {
      await this._ctx.suspend();
      return false;
    } else if (this._ctx.state === 'suspended') {
      await this._ctx.resume();
      return true;
    }
    return false;
  }

  /** Connect to a MediaStream (system audio loopback or microphone). */
  connect(stream) {
    this.disconnect();
    this._ctx      = new (window.AudioContext || window.webkitAudioContext)();
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = FFT_SIZE;
    this._analyser.smoothingTimeConstant = SMOOTH_BASE;
    this._raw      = new Uint8Array(this._analyser.frequencyBinCount);
    this._buildLogMap(this._ctx.sampleRate, this._analyser.frequencyBinCount);
    this._sourceNode = this._ctx.createMediaStreamSource(stream);
    this._sourceNode.connect(this._analyser);
    this.metadata = {
      title: 'LIVE AUDIO FEED',
      artist: 'HARDWARE / MIC INPUT',
      elapsed: 0,
      duration: 0,
    };
  }

  /** Connect and play an HTMLAudioElement (for dropped local audio files). */
  connectElement(audioElement) {
    this.disconnect();
    this._ctx      = new (window.AudioContext || window.webkitAudioContext)();
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = FFT_SIZE;
    this._analyser.smoothingTimeConstant = SMOOTH_BASE;
    this._raw      = new Uint8Array(this._analyser.frequencyBinCount);
    this._buildLogMap(this._ctx.sampleRate, this._analyser.frequencyBinCount);
    this._activeElement = audioElement;
    this._sourceNode = this._ctx.createMediaElementSource(audioElement);
    this._sourceNode.connect(this._analyser);
    // Route to audio hardware so user hears the playback
    this._analyser.connect(this._ctx.destination);
    if (this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
    this.metadata = {
      title: 'AUDIO STREAM',
      artist: 'LOCAL MEDIA',
      elapsed: 0,
      duration: audioElement.duration || 0,
    };
  }

  /** Decode and play a local File directly via Web Audio buffer source (bypasses CSP blob: restrictions). */
  async loadFile(file) {
    this.disconnect();
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this._ctx.state === 'suspended') {
      await this._ctx.resume();
    }
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = FFT_SIZE;
    this._analyser.smoothingTimeConstant = SMOOTH_BASE;
    this._raw = new Uint8Array(this._analyser.frequencyBinCount);
    this._buildLogMap(this._ctx.sampleRate, this._analyser.frequencyBinCount);

    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this._ctx.decodeAudioData(arrayBuffer);

    const bufferSource = this._ctx.createBufferSource();
    bufferSource.buffer = audioBuffer;
    bufferSource.loop = true;

    bufferSource.connect(this._analyser);
    this._analyser.connect(this._ctx.destination);

    bufferSource.start(0);
    this._bufferSource = bufferSource;

    const baseName = (file.name || 'UNTITLED').replace(/\.[^/.]+$/, '');
    let title = baseName;
    let artist = 'LOCAL TRACK';
    if (baseName.includes(' - ')) {
      const parts = baseName.split(' - ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    }
    this.metadata = {
      title: title.toUpperCase(),
      artist: artist.toUpperCase(),
      elapsed: 0,
      duration: audioBuffer.duration || 0,
    };
  }

  disconnect() {
    if (this._activeElement) {
      this._activeElement.pause();
      this._activeElement.src = '';
      this._activeElement = null;
    }
    if (this._bufferSource) {
      try { this._bufferSource.stop(); } catch (_) {}
      try { this._bufferSource.disconnect(); } catch (_) {}
      this._bufferSource = null;
    }
    if (this._sourceNode) {
      try { this._sourceNode.disconnect(); } catch (_) {}
      this._sourceNode = null;
    }
    if (this._ctx) {
      try { this._ctx.close(); } catch (_) {}
      this._ctx      = null;
      this._analyser = null;
      this._raw      = null;
    }
    this.bins.fill(0);
    this._decay.fill(0);
    this.beat   = false;
    this.energy = this.kick = this.snare = this.hihat = this.bass = this.mid = this.treble = 0;
    this._prevLow = this._prevMid = this._prevHigh = this._prevEnergy = 0;
    this._lastKickTime = this._lastSnareTime = this._lastBeatTime = 0;
    this._history.fill(0);
    this._lowHist.fill(0);
    this._midHist.fill(0);
    this._highHist.fill(0);
  }

  /** Precompute logarithmic bin boundaries (35% sub-bass, 40% mids, 25% highs), sub-bin interpolation weights, and acoustic tilt */
  _buildLogMap(sampleRate, binCount) {
    const nyquist = sampleRate / 2;
    const binHz   = nyquist / binCount;
    const map     = new Array(OUT_BINS);

    // 35% sub-bass/kick (0-89: 24-120Hz), 40% mids (90-191: 120-3500Hz), 25% highs (192-255: 3500-18500Hz)
    const getFreq = idx => {
      if (idx <= 90) {
        return 24 * Math.pow(120 / 24, idx / 90);
      } else if (idx <= 192) {
        return 120 * Math.pow(3500 / 120, (idx - 90) / 102);
      } else {
        return 3500 * Math.pow(18500 / 3500, (idx - 192) / 64);
      }
    };

    for (let i = 0; i < OUT_BINS; i++) {
      const f0 = getFreq(i);
      const f1 = getFreq(i + 1);
      const centerFreq = Math.sqrt(f0 * f1);

      const c0 = f0 / binHz;
      const c1 = f1 / binHz;
      const span = c1 - c0;

      // Gentle high-frequency air compensation (max 1.45x boost, no harsh overdrive)
      const tilt = 1.0 + (i / OUT_BINS) * 0.45;

      let bandTag = 0;
      if (centerFreq >= 40 && centerFreq <= 100) bandTag = 1;       // Low kick/sub-bass (40-100 Hz)
      else if (centerFreq >= 800 && centerFreq <= 2500) bandTag = 2;// Mid snare/vocal (800-2500 Hz)
      else if (centerFreq >= 6000) bandTag = 3;                     // High sparkle/hi-hat (6000+ Hz)

      if (span < 1.0) {
        // Sub-bin frequencies: interpolate smoothly between adjacent raw FFT bins
        const cMid = (c0 + c1) * 0.5;
        const k0 = Math.max(0, Math.min(binCount - 2, Math.floor(cMid)));
        const frac = Math.max(0, Math.min(1, cMid - k0));
        map[i] = { mode: 0, k0, k1: k0 + 1, frac, tilt, centerFreq, bandTag };
      } else {
        // Multi-bin frequencies: continuous fractional overlap integration
        const k0 = Math.max(0, Math.min(binCount - 1, Math.floor(c0)));
        const k1 = Math.max(k0 + 1, Math.min(binCount, Math.ceil(c1)));
        map[i] = {
          mode: 1,
          k0,
          k1,
          c0,
          c1,
          invSpan: 1 / Math.max(0.0001, c1 - c0),
          tilt,
          centerFreq,
          bandTag,
        };
      }
    }
    this._logMap = map;
  }

  /**
   * Read latest FFT data and compute multi-band onset and transient detection.
   * @param {number} sensitivity  Amplitude multiplier (0.1 – 4.0).
   */
  update(sensitivity = 1.0) {
    if (!this._analyser) return;

    this._analyser.getByteFrequencyData(this._raw);

    let total = 0;
    let bSum = 0, bCount = 0;
    let mSum = 0, mCount = 0;
    let tSum = 0, tCount = 0;
    let lowSum = 0, lowCount = 0;
    let midSum = 0, midCount = 0;
    let highSum = 0, highCount = 0;

    const map = this._logMap;
    if (!map) return;

    // Calibrated baseline gain gives comfortable headroom at 1.0x sensitivity
    const BASE_GAIN = 0.65;

    for (let i = 0; i < OUT_BINS; i++) {
      const entry = map[i];
      let val = 0;
      if (entry.mode === 0) {
        val = this._raw[entry.k0] * (1 - entry.frac) + this._raw[entry.k1] * entry.frac;
      } else {
        let sum = 0;
        for (let k = entry.k0; k < entry.k1; k++) {
          const w = Math.max(0, Math.min(entry.c1, k + 1) - Math.max(entry.c0, k));
          sum += this._raw[k] * w;
        }
        val = sum * entry.invSpan;
      }

      const rawVal = (val / 255.0) * sensitivity * BASE_GAIN * entry.tilt;
      const target = Math.min(1.0, Math.max(0.0, rawVal));

      // Fast-attack, smooth-decay ballistic envelope
      if (target >= this._decay[i]) {
        this._decay[i] = target;
      } else {
        this._decay[i] = this._decay[i] * 0.85 + target * 0.15;
      }
      this.bins[i] = this._decay[i];
      total += target;

      // Group into acoustic bands for general visualizers
      if (entry.centerFreq <= 160) {
        bSum += target;
        bCount++;
      } else if (entry.centerFreq >= 400 && entry.centerFreq <= 3200) {
        mSum += target;
        mCount++;
      } else if (entry.centerFreq >= 5000 && entry.centerFreq <= 16000) {
        tSum += target;
        tCount++;
      }

      // Exact 3-band spectral flux bands (40-100Hz, 800-2500Hz, 6000Hz+)
      if (entry.bandTag === 1) {
        lowSum += target;
        lowCount++;
      } else if (entry.bandTag === 2) {
        midSum += target;
        midCount++;
      } else if (entry.bandTag === 3) {
        highSum += target;
        highCount++;
      }
    }

    // Energy calibrated across 0.0-1.0 dynamic range for visualizers & meters
    const meanBin = total / OUT_BINS;
    this.energy = Math.min(1.0, meanBin * 2.2);

    const curBass   = bCount > 0 ? bSum / bCount : 0;
    const curMid    = mCount > 0 ? mSum / mCount : 0;
    const curTreble = tCount > 0 ? tSum / tCount : 0;
    const curLow    = lowCount > 0 ? lowSum / lowCount : curBass;
    const curFluxMid= midCount > 0 ? midSum / midCount : curMid;
    const curHigh   = highCount > 0 ? highSum / highCount : curTreble;

    // Smoothed continuous bands
    this.bass   += (curBass - this.bass) * 0.20;
    this.mid    += (curMid - this.mid) * 0.20;
    this.treble += (curTreble - this.treble) * 0.20;

    // Transient, BPM, phase & beat tracking
    this._detectTransients(curLow, curFluxMid, curHigh, this.energy);
  }

  _detectTransients(curLow, curMid, curHigh, energy) {
    const now = performance.now() * 0.001;
    const dt = this._lastFrameTime > 0 ? Math.max(0.001, Math.min(0.1, now - this._lastFrameTime)) : 1 / 60;
    this._lastFrameTime = now;

    if (this.isPlaying) {
      this.metadata.elapsed += dt;
    }

    // 1. History buffers & moving averages
    this._lowHist[this._histIdx] = curLow;
    this._midHist[this._histIdx] = curMid;
    this._highHist[this._histIdx] = curHigh;
    this._history[this._histIdx] = energy;
    this._histIdx = (this._histIdx + 1) % BEAT_WIN;

    let lowMean = 0, midMean = 0, highMean = 0, mean = 0;
    for (let i = 0; i < BEAT_WIN; i++) {
      lowMean  += this._lowHist[i];
      midMean  += this._midHist[i];
      highMean += this._highHist[i];
      mean     += this._history[i];
    }
    lowMean  /= BEAT_WIN;
    midMean  /= BEAT_WIN;
    highMean /= BEAT_WIN;
    mean     /= BEAT_WIN;

    // ── 1. Low-band Kick / Sub-bass detection (40-100 Hz spectral flux) ──
    const lowFlux = Math.max(0, curLow - this._prevLow);
    const kickThreshold = Math.max(0.015, lowMean * 0.20);
    const isKick = lowFlux > kickThreshold && (curLow > lowMean * 1.15 || curLow > 0.12);

    let kickHit = false;
    if (isKick && (now - this._lastKickTime > 0.11)) {
      kickHit = true;
      const hitStrength = Math.min(1.0, (lowFlux / (kickThreshold * 2.2)) * 0.65 + (curLow / Math.max(0.08, lowMean * 1.5)) * 0.35);
      this.kick = Math.max(this.kick, hitStrength);

      if (this._lastKickTime > 0) {
        const interval = now - this._lastKickTime;
        if (interval >= 0.25 && interval <= 1.25) {
          this._kickTimes.push(interval);
          if (this._kickTimes.length > 12) this._kickTimes.shift();

          const sorted = [...this._kickTimes].sort((a, b) => a - b);
          let medInterval = sorted[Math.floor(sorted.length / 2)];
          if (medInterval < 0.42) medInterval *= 2;
          const estBpm = Math.max(75, Math.min(178, 60 / medInterval));
          this.bpm += (estBpm - this.bpm) * 0.12;
        }
      }
      this._lastKickTime = now;
    } else {
      const lowPresence = Math.min(1.0, curLow * 1.7);
      this.kick = Math.max(this.kick * 0.92, lowPresence * 0.55);
    }
    this._prevLow = curLow;

    // ── 2. Mid-band Snare / Vocal detection (800-2500 Hz spectral flux) ──
    const midFlux = Math.max(0, curMid - this._prevMid);
    const snareThreshold = Math.max(0.014, midMean * 0.20);
    const isSnare = midFlux > snareThreshold && (curMid > midMean * 1.12 || curMid > 0.10);

    if (isSnare && (now - this._lastSnareTime > 0.10)) {
      this._lastSnareTime = now;
      const snareStrength = Math.min(1.0, (midFlux / (snareThreshold * 2.2)) * 0.70 + (curMid / Math.max(0.06, midMean * 1.4)) * 0.30);
      this.snare = Math.max(this.snare, snareStrength);
    } else {
      const midPresence = Math.min(1.0, curMid * 1.8);
      this.snare = Math.max(this.snare * 0.89, midPresence * 0.45);
    }
    this._prevMid = curMid;

    // ── 3. High-band Hi-Hat / Sparkle detection (6000 Hz+ spectral flux) ──
    const highFlux = Math.max(0, curHigh - this._prevHigh);
    const highThreshold = Math.max(0.008, highMean * 0.18);
    const isHihat = highFlux > highThreshold && (curHigh > highMean * 1.10 || curHigh > 0.05);

    if (isHihat) {
      const hihatStrength = Math.min(1.0, (highFlux / (highThreshold * 2.0)) * 0.75 + (curHigh / Math.max(0.03, highMean * 1.4)) * 0.25);
      this.hihat = Math.max(this.hihat, hihatStrength);
    } else {
      const highPresence = Math.min(1.0, curHigh * 2.2);
      this.hihat = Math.max(this.hihat * 0.86, highPresence * 0.40);
    }
    this._prevHigh = curHigh;

    // ── 4. Live Rhythmic Phase tracking ──
    const phaseDelta = (this.bpm / 60.0) * dt;
    this.phase = (this.phase + phaseDelta) % 1.0;
    if (kickHit) {
      this.phase = this.phase * 0.75;
    }

    // ── 5. Master Beat detection (rhythmically gated onset) ──
    let variance = 0;
    for (let i = 0; i < BEAT_WIN; i++) {
      const d = this._history[i] - mean;
      variance += d * d;
    }
    variance /= BEAT_WIN;

    const C = Math.max(1.30, -0.0025714 * variance + 1.50);
    const globalOnset = energy > C * mean && (energy - this._prevEnergy) > 0.025;
    this._prevEnergy = energy;

    if ((kickHit || globalOnset) && (now - this._lastBeatTime > 0.15)) {
      this.beat = true;
      this._lastBeatTime = now;
    } else {
      this.beat = false;
    }
  }

  /** Transient telemetry for UI, typography HUD, and advanced visualizers */
  get telemetry() {
    return {
      kick: this.kick,
      snare: this.snare,
      hihat: this.hihat,
      bass: this.bass,
      mid: this.mid,
      treble: this.treble,
      energy: this.energy,
      bpm: this.bpm,
      phase: this.phase,
      metadata: this.metadata,
    };
  }
}
