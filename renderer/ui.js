'use strict';
/**
 * ui.js — the floating glass dock.
 * Owns every piece of on-screen chrome: audio-source toggle, popover menus for
 * visualizer + color, sensitivity slider, window buttons, auto-hide behaviour,
 * keyboard shortcuts and the beat-reactive accent glow / mini spectrum.
 *
 * app.js supplies callbacks and calls react() once per frame with analyser data.
 */

import { THEMES } from './visualizer.js';

const SPECTRUM_BARS = 56;
const IDLE_MS       = 2800;   // hide the dock this long after the last input
const VIZ_ORDER     = ['bars', 'orb', 'particles', 'random', 'speaker', 'baby', 'exc3'];

const rgbToHex = ([r, g, b]) => {
  const c = n => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

export class DockUI {
  /**
   * @param {{onSource:Function, onViz:Function, onTheme:Function}} handlers
   */
  constructor(handlers) {
    this._on = handlers;

    this._root      = document.getElementById('dock');
    this._zone      = document.getElementById('dock-zone');
    this._peek      = document.getElementById('dock-peek');
    this._statusEl  = document.getElementById('status');
    this._dotEl     = document.getElementById('status-dot');
    this._sensEl    = document.getElementById('sensitivity');
    this._sensVal   = document.getElementById('sens-val');
    this._flashEl   = document.getElementById('beat-flash');
    this._hintEl    = document.getElementById('hint');
    this._playBtn   = document.getElementById('btn-play-pause');
    this._css       = document.documentElement.style;

    this._collapsed   = false;   // toggled by the user (H / peek / hide button)
    this._idle        = false;   // auto-hidden after inactivity
    this._audioLive   = false;
    this._openMenu    = null;
    this._idleTimer   = 0;
    this._hintTimer   = 0;

    this._energy = 0;            // smoothed, for the accent glow
    this._beat   = 0;            // decays each frame

    this._buildSpectrum();
    this._wireSource();
    this._wirePlayPause();
    this._wireMenus();
    this._wirePresets();
    this._wireSlider();
    this._wireWindow();
    this._wireRetro();
    this._wireVisibility();
    this._wireKeyboard();

    this.setTheme('neon');
    this._selectMenuItem('viz', 'bars');
    this._syncSlider();
  }

  // ── Public API ──────────────────────────────────────────────────

  get sensitivity() { return parseFloat(this._sensEl.value); }

  /** Update play/pause button state and visibility on the panel. */
  setPlayState(isPlaying, canControl = true) {
    this._isPlaying = isPlaying;
    if (!this._playBtn) return;
    this._playBtn.hidden = !canControl;
    if (!canControl) return;
    const icon = document.getElementById('play-icon');
    const label = document.getElementById('play-label');
    if (isPlaying) {
      if (icon) icon.innerHTML = '&#9208;';
      if (label) label.textContent = 'PAUSE';
      this._playBtn.classList.remove('paused');
      this._playBtn.title = 'Pause playback (Space)';
      this._playBtn.setAttribute('aria-label', 'Pause playback');
    } else {
      if (icon) icon.innerHTML = '&#9654;';
      if (label) label.textContent = 'PLAY';
      this._playBtn.classList.add('paused');
      this._playBtn.title = 'Resume playback (Space)';
      this._playBtn.setAttribute('aria-label', 'Resume playback');
    }
  }

  setStatus(msg, state = '') {
    this._statusEl.textContent = msg;
    this._dotEl.className = 'dot' + (state ? ' ' + state : '');
    this._audioLive = state === 'active';
    document.body.classList.toggle('audio-live', this._audioLive);
    if (this._audioLive) this._scheduleIdle();
    else { this._idle = false; this._applyVisibility(); }
  }

  /** Reflect a programmatic visualizer change back into the menu. */
  syncViz(value) { this._selectMenuItem('viz', value); }

  /** Reflect active audio source in the segmented control and toggle panel play button visibility. */
  syncSource(kind) {
    for (const b of document.querySelectorAll('#source-seg .seg-btn')) {
      const match = b.dataset.src === kind;
      b.classList.toggle('active', match);
      b.setAttribute('aria-pressed', String(match));
    }
    // Only appear if the user chose the file option
    this.setPlayState(this._isPlaying ?? true, kind === 'file');
  }

  /** Update accent CSS variables + the color menu selection. */
  setTheme(name) {
    const t = THEMES[name];
    if (!t) return;
    const a = rgbToHex(t.a);
    const b = rgbToHex(t.b);
    const mix = rgbToHex(t.a.map((v, i) => (v + t.b[i]) / 2));
    this._css.setProperty('--acc-a', a);
    this._css.setProperty('--acc-b', b);
    this._css.setProperty('--acc-mix', mix);
    this._selectMenuItem('theme', name);
  }

  /** Called every animation frame from app.js. */
  react(bins, energy, beat, details = {}) {
    const kick = details.kick ?? (beat ? 1 : 0);
    // Smoothed energy drives the dock's ambient glow.
    this._energy += (Math.min(energy * 2.2, 1) - this._energy) * 0.12;
    this._beat *= 0.86;
    if (beat || kick > 0.4) {
      this._beat = Math.max(this._beat, kick > 0.4 ? kick : 1);
      this._flashEl.classList.add('pulse');
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => this._flashEl.classList.remove('pulse'), 90);
    }
    this._css.setProperty('--energy', this._energy.toFixed(3));
    this._css.setProperty('--beat', this._beat.toFixed(3));

    // Mini spectrum — skip the DOM work while the dock is off-screen.
    if (this._collapsed || this._idle) return;
    for (let i = 0; i < SPECTRUM_BARS; i++) {
      const src = Math.floor((i / SPECTRUM_BARS) * (bins.length - 1));
      let v = 0;
      for (let j = src; j < src + 4 && j < bins.length; j++) v = Math.max(v, bins[j]);
      const prev = this._smooth[i];
      // fast attack, slow release
      this._smooth[i] = v > prev ? v : prev * 0.82 + v * 0.18;
      this._sbars[i].style.transform = `scaleY(${(0.04 + this._smooth[i] * 0.96).toFixed(3)})`;
    }
  }

  // ── Build helpers ──────────────────────────────────────────────

  _buildSpectrum() {
    const wrap = document.getElementById('dock-spectrum');
    this._sbars  = [];
    this._smooth = new Float32Array(SPECTRUM_BARS);
    for (let i = 0; i < SPECTRUM_BARS; i++) {
      const bar = document.createElement('span');
      bar.className = 'sbar';
      wrap.appendChild(bar);
      this._sbars.push(bar);
    }
  }

  _wireSource() {
    for (const btn of document.querySelectorAll('#source-seg .seg-btn')) {
      btn.addEventListener('click', () => {
        const src = btn.dataset.src;
        this.syncSource(src);
        this._on.onSource(src);
      });
    }
  }

  _wirePlayPause() {
    this._playBtn?.addEventListener('click', () => {
      this._on.onPlayPause?.();
      this._markActivity();
    });
  }

  _wireMenus() {
    this._menus = {
      viz:   { pop: document.getElementById('viz-pop'),   trigger: document.getElementById('viz-trigger'),   valueEl: document.getElementById('viz-value') },
      theme: { pop: document.getElementById('theme-pop'), trigger: document.getElementById('theme-trigger'), valueEl: document.getElementById('theme-value') },
    };

    for (const [key, m] of Object.entries(this._menus)) {
      m.trigger.addEventListener('click', e => {
        e.stopPropagation();
        this._toggleMenu(this._openMenu === key ? null : key);
      });
      for (const item of m.pop.querySelectorAll('[role^="menuitem"]')) {
        item.addEventListener('click', () => {
          const value = item.dataset.value;
          this._selectMenuItem(key, value);
          (key === 'viz' ? this._on.onViz : this._on.onTheme)(value);
          if (key === 'theme') this.setTheme(value);
          this._toggleMenu(null);
          this._markActivity();
        });
      }
    }

    document.addEventListener('click', () => this._toggleMenu(null));
    for (const m of Object.values(this._menus)) {
      m.pop.addEventListener('keydown', e => {
        const items = [...m.pop.querySelectorAll('[role^="menuitem"]')];
        const index = items.indexOf(document.activeElement);
        if (e.key === 'Escape') {
          e.preventDefault();
          this._toggleMenu(null);
          m.trigger.focus();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
            : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next].focus();
        }
      });
    }
  }

  _toggleMenu(key) {
    for (const [k, m] of Object.entries(this._menus)) {
      const open = k === key;
      m.pop.hidden = !open;
      m.trigger.setAttribute('aria-expanded', String(open));
    }
    this._openMenu = key;
    if (key) {
      this._markActivity();
      this._menus[key].pop.querySelector('[aria-checked="true"], [role^="menuitem"]')?.focus();
    }
  }

  _selectMenuItem(key, value) {
    const m = this._menus[key];
    if (!m) return;
    let label = value;
    for (const item of m.pop.querySelectorAll('[role^="menuitem"]')) {
      const on = item.dataset.value === value;
      item.setAttribute('aria-checked', String(on));
      if (on) label = item.textContent.trim();
    }
    m.valueEl.textContent = label;
    if (key === 'viz') {
      document.querySelectorAll('[data-preset]').forEach((btn, index) => {
        const selected = btn.dataset.preset === value;
        btn.setAttribute('aria-pressed', String(selected));
        if (selected) {
          document.getElementById('stage-number').textContent = String(index + 1).padStart(2, '0');
          document.getElementById('stage-name').textContent = btn.dataset.label;
          document.getElementById('stage-description').textContent = btn.dataset.description;
        }
      });
    }
  }

  _wirePresets() {
    const buttons = [...document.querySelectorAll('[data-preset]')];
    buttons.forEach((btn, index) => {
      btn.addEventListener('click', () => {
        this.syncViz(btn.dataset.preset);
        this._on.onViz(btn.dataset.preset);
        this._markActivity();
      });
      btn.addEventListener('keydown', e => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
          : (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
      });
    });
  }

  _wireSlider() {
    this._sensEl.addEventListener('input', () => { this._syncSlider(); this._markActivity(); });
  }

  _syncSlider() {
    const el = this._sensEl;
    const pct = (el.value - el.min) / (el.max - el.min) * 100;
    el.style.setProperty('--fill', pct.toFixed(1) + '%');
    this._sensVal.innerHTML = parseFloat(el.value).toFixed(1) + '&times;';
  }

  _wireWindow() {
    const api = window.electronAPI;
    document.getElementById('btn-minimize') ?.addEventListener('click', () => api?.windowMinimize());
    document.getElementById('btn-maximize') ?.addEventListener('click', () => api?.windowMaximize());
    document.getElementById('btn-close')    ?.addEventListener('click', () => api?.windowClose());
    document.getElementById('btn-fullscreen')?.addEventListener('click', () => this._toggleFullscreen());

    if (!api) document.getElementById('chrome-zone').style.display = 'none';
  }

  async _toggleFullscreen() {
    if (window.electronAPI) return window.electronAPI.windowFullscreenToggle();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      this._flashHint('Fullscreen is unavailable in this browser.');
    }
  }

  _wireRetro() {
    this._retroOn  = true;
    this._retroBtn = document.getElementById('btn-retro');
    this._retroBtn?.addEventListener('click', () => { this._toggleRetro(); this._markActivity(); });
  }

  _toggleRetro(force) {
    this._retroOn = typeof force === 'boolean' ? force : !this._retroOn;
    this._retroBtn?.classList.toggle('active', this._retroOn);
    this._retroBtn?.setAttribute('aria-pressed', String(this._retroOn));
    this._on.onRetro?.(this._retroOn);
    this._flashHint(`Retro CRT · <b>${this._retroOn ? 'on' : 'off'}</b>`);
  }

  _wireVisibility() {
    document.getElementById('btn-hide-dock').addEventListener('click', () => this._setCollapsed(true));
    this._peek.addEventListener('click', e => { e.stopPropagation(); this._setCollapsed(false); });

    const activity = () => this._markActivity();
    window.addEventListener('mousemove', activity);
    this._root.addEventListener('focusin', activity);
    window.addEventListener('mousedown', activity);
    window.addEventListener('wheel', activity, { passive: true });
    this._root.addEventListener('mouseenter', () => { clearTimeout(this._idleTimer); });
    this._root.addEventListener('mouseleave', () => this._scheduleIdle());
  }

  _wireKeyboard() {
    window.addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key.toLowerCase()) {
        case 'h':
          this._setCollapsed(!this._collapsed);
          break;
        case ' ':
        case 'space':
          if (this._on.onPlayPause) {
            e.preventDefault();
            this._on.onPlayPause();
          }
          break;
        case 'f':
          this._toggleFullscreen();
          break;
        case 'r':
          this._toggleRetro();
          break;
        case 'c': {
          const names = Object.keys(THEMES);
          const cur = this._menus.theme.pop.querySelector('[aria-checked="true"]')?.dataset.value ?? 'neon';
          const next = names[(names.indexOf(cur) + 1) % names.length];
          this.setTheme(next);
          this._on.onTheme(next);
          this._flashHint(`Color · <b>${next}</b>`);
          break;
        }
        case '[':
        case ']': {
          const step = e.key === ']' ? 0.15 : -0.15;
          this._sensEl.value = Math.min(4, Math.max(0.1, this.sensitivity + step)).toFixed(2);
          this._syncSlider();
          this._flashHint(`Sensitivity · <b>${this.sensitivity.toFixed(1)}×</b>`);
          break;
        }
        default:
          if (e.key >= '1' && e.key <= String(VIZ_ORDER.length)) {
            const value = VIZ_ORDER[+e.key - 1];
            this.syncViz(value);
            this._on.onViz(value);
            this._flashHint(`<b>${this._menus.viz.valueEl.textContent}</b>`);
          } else {
            return;
          }
      }
      this._markActivity();
    });
  }

  // ── Visibility state machine ───────────────────────────────────

  _setCollapsed(state) {
    this._collapsed = state;
    if (!state) this._idle = false;
    this._toggleMenu(null);
    this._applyVisibility();
    if (state) this._peek.focus();
    else this._root.querySelector('[data-preset][aria-pressed="true"]')?.focus();
    if (this._audioLive && !state) this._scheduleIdle();
  }

  _markActivity() {
    document.body.classList.remove('cursor-hidden');
    if (this._idle) { this._idle = false; this._applyVisibility(); }
    this._scheduleIdle();
  }

  _scheduleIdle() {
    clearTimeout(this._idleTimer);
    if (!this._audioLive || this._collapsed || this._openMenu) return;
    this._idleTimer = setTimeout(() => {
      if (this._root.matches(':hover') || this._root.contains(document.activeElement) || this._openMenu) return;
      this._idle = true;
      this._applyVisibility();
      document.body.classList.add('cursor-hidden');
    }, IDLE_MS);
  }

  _applyVisibility() {
    const hidden = this._collapsed || this._idle;
    this._root.dataset.hidden = String(hidden);
    this._root.inert = hidden;
    document.body.classList.toggle('controls-hidden', hidden);
  }

  _flashHint(html) {
    this._hintEl.innerHTML = html;
    this._hintEl.classList.add('show');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this._hintEl.classList.remove('show'), 1100);
  }
}
