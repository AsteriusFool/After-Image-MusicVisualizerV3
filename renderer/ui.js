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
import { loadLibrary, addShader, removeShader, renameShader, saveLastSource } from './shader-library.js';

const SPECTRUM_BARS = 56;
const IDLE_MS       = 2800;   // hide the dock this long after the last input
const VIZ_ORDER     = ['bars', 'orb', 'particles', 'random', 'speaker', 'exc3', 'impulse', 'custom', 'aura'];

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
    this._sectionTag = document.getElementById('section-tag');
    this._shaderPanel  = document.getElementById('shader-panel');
    this._shaderSource = document.getElementById('shader-source');
    this._shaderError  = document.getElementById('shader-error');
    this._shaderSaveName      = document.getElementById('shader-save-name');
    this._shaderLibraryEl     = document.getElementById('shader-library');
    this._shaderLibraryTrigger = document.getElementById('shader-library-trigger');
    this._shaderLibraryCountEl = document.getElementById('shader-library-count');
    this._shaderLibrarySearch  = document.getElementById('shader-library-search');
    this._css       = document.documentElement.style;

    this._collapsed   = false;   // toggled by the user (H / peek / hide button)
    this._idle        = false;   // auto-hidden after inactivity
    this._audioLive   = false;
    this._openMenu    = null;
    this._idleTimer   = 0;
    this._hintTimer   = 0;
    this._autoOn      = false;   // Auto-Director: switch visuals on detected drops
    this._lastSection = null;
    this._renamingShaderId = null;

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
    this._wireAuto();
    this._wirePin();
    this._wireRecord();
    this._wireShaderEditor();
    this._wireVisibility();
    this._wireKeyboard();

    this.setTheme('neon');
    this._selectMenuItem('viz', 'bars');
    this._syncSlider();
  }

  // ── Public API ──────────────────────────────────────────────────

  get sensitivity() { return parseFloat(this._sensEl.value); }

  /** True when Auto-Director (auto-switch visuals on detected song drops) is on. */
  get autoDirectorOn() { return this._autoOn; }

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

  /** Advances to the next (or, with step -1, previous) visualizer in the preset order. */
  cycleViz(step = 1) {
    const cur = this._menus.viz.pop.querySelector('[aria-checked="true"]')?.dataset.value ?? VIZ_ORDER[0];
    const idx = VIZ_ORDER.indexOf(cur);
    const next = VIZ_ORDER[(idx + step + VIZ_ORDER.length) % VIZ_ORDER.length];
    this.syncViz(next);
    this._on.onViz(next);
    return next;
  }

  /** Advances to the next (or, with step -1, previous) color theme. */
  cycleTheme(step = 1) {
    const names = Object.keys(THEMES);
    const cur = this._menus.theme.pop.querySelector('[aria-checked="true"]')?.dataset.value ?? 'neon';
    const idx = names.indexOf(cur);
    const next = names[(idx + step + names.length) % names.length];
    this.setTheme(next);
    this._on.onTheme(next);
    this._flashHint(`Color · <b>${next}</b>`);
    return next;
  }

  /** Reflects the detected song-section (intro/build/drop/peak/breakdown) next to the signal meter. */
  setSectionTag(section) {
    if (!this._sectionTag || section === this._lastSection) return;
    this._lastSection = section;
    this._sectionTag.textContent = section ? `· ${section.toUpperCase()}` : '';
  }

  /** Toggles the recording indicator on the REC button. */
  setRecordingState(active) {
    this._recBtn?.classList.toggle('recording', !!active);
    this._recBtn?.classList.toggle('active', !!active);
    this._recBtn?.setAttribute('aria-pressed', String(!!active));
  }

  /** Prefills the live-shader editor textarea (used when entering Live Shader mode). */
  setShaderSource(source) {
    if (this._shaderSource) this._shaderSource.value = source ?? '';
    if (this._shaderError) this._shaderError.textContent = '';
    this._renderShaderLibrary();
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
      shaderLibrary: { pop: document.getElementById('shader-library-pop'), trigger: document.getElementById('shader-library-trigger'), valueEl: null },
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

    // Close on outside click only — a click inside an open popover (e.g. the
    // shader library's rename/delete buttons or its search box) must not
    // also bubble up and slam the whole popover shut. Use composedPath()
    // (the path captured at dispatch time) rather than e.target.closest():
    // the rename/delete click handlers re-render the list synchronously
    // (before this listener runs), which detaches the clicked button from
    // the tree — closest() on a detached node can no longer walk up to
    // find the popover, so it would wrongly look like an outside click.
    document.addEventListener('click', e => {
      const path = e.composedPath ? e.composedPath() : [];
      if (path.some(el => el.classList?.contains?.('menu-pop'))) return;
      this._toggleMenu(null);
    });
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
      const pop = this._menus[key].pop;
      (pop.querySelector('[aria-checked="true"], [role^="menuitem"]') || pop.querySelector('.shader-library-search'))?.focus();
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
      if (this._shaderPanel) {
        const isCustom = value === 'custom';
        this._shaderPanel.hidden = !isCustom;
        if (isCustom) this._on.onCustomMode?.();
        else if (this._openMenu === 'shaderLibrary') this._toggleMenu(null);
      }
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

    // Hide the custom titlebar once truly fullscreen, on either path: native OS
    // fullscreen in Electron (no DOM signal of its own — main process tells us),
    // or the browser Fullscreen API when running outside Electron.
    api?.onFullscreenChange?.(isFullScreen => {
      document.body.classList.toggle('is-fullscreen', isFullScreen);
    });
    document.addEventListener('fullscreenchange', () => {
      document.body.classList.toggle('is-fullscreen', !!document.fullscreenElement);
    });
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

  _wireAuto() {
    this._autoBtn = document.getElementById('btn-auto');
    this._autoBtn?.addEventListener('click', () => {
      this._autoOn = !this._autoOn;
      this._autoBtn.classList.toggle('active', this._autoOn);
      this._autoBtn.setAttribute('aria-pressed', String(this._autoOn));
      this._flashHint(`Auto-Director · <b>${this._autoOn ? 'on' : 'off'}</b>`);
      this._markActivity();
    });
  }

  _wirePin() {
    this._pinBtn = document.getElementById('btn-pin');
    this._pinBtn?.addEventListener('click', async () => {
      const on = await this._on.onPin?.();
      this._pinBtn.classList.toggle('active', !!on);
      this._pinBtn.setAttribute('aria-pressed', String(!!on));
      this._flashHint(`Always on top · <b>${on ? 'on' : 'off'}</b>`);
      this._markActivity();
    });
  }

  _wireRecord() {
    this._recBtn = document.getElementById('btn-record');
    this._recBtn?.addEventListener('click', () => {
      this._on.onRecordToggle?.();
      this._markActivity();
    });
  }

  _wireShaderEditor() {
    document.getElementById('btn-shader-apply')?.addEventListener('click', () => this._applyShader());
    document.getElementById('btn-shader-reset')?.addEventListener('click', () => {
      const res = this._on.onShaderReset?.();
      if (res && !res.ok) {
        this._shaderError.textContent = res.error || 'Could not reset shader.';
      } else {
        this._flashHint('Shader <b>reset</b>');
        saveLastSource(this._shaderSource?.value ?? '');
      }
    });
    document.getElementById('btn-shader-save')?.addEventListener('click', () => this._saveShader());
    this._shaderSaveName?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this._saveShader(); }
    });
    this._shaderSource?.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this._applyShader(); }
    });
    this._shaderLibrarySearch?.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { this._toggleMenu(null); this._shaderLibraryTrigger?.focus(); }
    });
    this._shaderLibrarySearch?.addEventListener('input', () => this._renderShaderLibrary());
    this._shaderLibraryEl?.addEventListener('click', e => {
      const row = e.target.closest('.shader-lib-row');
      if (!row) return;
      const { id } = row.dataset;
      if (e.target.closest('.shader-lib-delete')) {
        removeShader(id);
        this._renderShaderLibrary();
      } else if (e.target.closest('.shader-lib-rename')) {
        this._renamingShaderId = id;
        this._renderShaderLibrary();
      } else if (e.target.closest('.shader-lib-load')) {
        this._loadSavedShader(id);
      }
    });
    this._renderShaderLibrary();
  }

  _applyShader() {
    const src = this._shaderSource?.value ?? '';
    const result = this._on.onShaderApply?.(src);
    if (result && !result.ok) {
      if (this._shaderError) this._shaderError.textContent = result.error || 'Shader failed to compile.';
    } else {
      if (this._shaderError) this._shaderError.textContent = '';
      this._flashHint('Shader <b>applied</b>');
      saveLastSource(src);
      this._renderShaderLibrary();
    }
  }

  _saveShader() {
    const src = this._shaderSource?.value ?? '';
    if (!src.trim()) return;
    const name = this._shaderSaveName?.value ?? '';
    addShader(name, src);
    if (this._shaderSaveName) this._shaderSaveName.value = '';
    this._flashHint('Shader <b>saved</b>');
    this._renderShaderLibrary();
  }

  _loadSavedShader(id) {
    const entry = loadLibrary().find(e => e.id === id);
    if (!entry) return;
    if (this._shaderSource) this._shaderSource.value = entry.source;
    const result = this._on.onShaderApply?.(entry.source);
    if (result && !result.ok) {
      if (this._shaderError) this._shaderError.textContent = result.error || 'Saved shader failed to compile.';
    } else {
      if (this._shaderError) this._shaderError.textContent = '';
      this._flashHint(`Loaded <b>${entry.name}</b>`);
      saveLastSource(entry.source);
    }
    this._toggleMenu(null);
    this._renderShaderLibrary();
  }

  _commitShaderRename(id, input, cancelled) {
    if (!cancelled) renameShader(id, input.value);
    this._renamingShaderId = null;
    this._renderShaderLibrary();
  }

  _renderShaderLibrary() {
    const all = loadLibrary();
    if (this._shaderLibraryCountEl) {
      this._shaderLibraryCountEl.textContent = all.length ? ` (${all.length})` : '';
    }
    if (!this._shaderLibraryEl) return;

    const query = (this._shaderLibrarySearch?.value ?? '').trim().toLowerCase();
    const list = query ? all.filter(e => e.name.toLowerCase().includes(query)) : all;
    const current = this._shaderSource?.value ?? '';
    this._shaderLibraryEl.innerHTML = '';

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'shader-lib-empty';
      empty.textContent = all.length ? 'No matches.' : 'No saved shaders yet.';
      this._shaderLibraryEl.appendChild(empty);
      return;
    }

    for (const entry of list) {
      const row = document.createElement('div');
      row.className = 'shader-lib-row' + (entry.source === current ? ' active' : '');
      row.dataset.id = entry.id;

      if (entry.id === this._renamingShaderId) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'shader-lib-rename-input';
        input.value = entry.name;
        input.maxLength = 40;
        let done = false;
        const commitOnce = cancelled => {
          if (done) return;
          done = true;
          this._commitShaderRename(entry.id, input, cancelled);
        };
        input.addEventListener('keydown', e => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); commitOnce(false); }
          else if (e.key === 'Escape') { e.preventDefault(); commitOnce(true); }
        });
        input.addEventListener('blur', () => commitOnce(false));
        row.appendChild(input);
        this._shaderLibraryEl.appendChild(row);
        input.focus();
        input.select();
        continue;
      }

      const load = document.createElement('button');
      load.className = 'shader-lib-load';
      load.title = 'Load & apply';
      load.textContent = entry.name; // user-authored text — never through innerHTML

      const rename = document.createElement('button');
      rename.className = 'shader-lib-rename';
      rename.title = 'Rename';
      rename.setAttribute('aria-label', 'Rename saved shader');
      rename.textContent = '✎';

      const del = document.createElement('button');
      del.className = 'shader-lib-delete';
      del.title = 'Delete';
      del.setAttribute('aria-label', 'Delete saved shader');
      del.textContent = '×';

      row.append(load, rename, del);
      this._shaderLibraryEl.appendChild(row);
    }
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
        case 'c':
          this.cycleTheme(1);
          break;
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
