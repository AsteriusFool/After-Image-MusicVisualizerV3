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
const VIZ_ORDER     = ['bars', 'orb', 'particles', 'random', 'speaker', 'exc3', 'impulse', 'custom'];

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

    const byId = id => document.getElementById(id);
    this._root = byId('dock'); this._zone = byId('dock-zone'); this._peek = byId('dock-peek');
    this._statusEl = byId('status'); this._dotEl = byId('status-dot');
    this._sensEl = byId('sensitivity'); this._sensVal = byId('sens-val');
    this._flashEl = byId('beat-flash'); this._hintEl = byId('hint');
    this._playBtn = byId('btn-play-pause'); this._sectionTag = byId('section-tag');
    this._shaderPanel = byId('shader-panel'); this._shaderSource = byId('shader-source');
    this._shaderError = byId('shader-error'); this._shaderSaveName = byId('shader-save-name');
    this._shaderLibraryEl = byId('shader-library'); this._shaderLibraryTrigger = byId('shader-library-trigger');
    this._shaderLibraryCountEl = byId('shader-library-count'); this._shaderLibrarySearch = byId('shader-library-search');
    this._css = document.documentElement.style;

    this._collapsed = false; this._idle = false; this._audioLive = false;
    this._openMenu = null; this._idleTimer = 0; this._hintTimer = 0;
    this._autoOn = false; this._lastSection = null; this._renamingShaderId = null;
    this._energy = 0; this._beat = 0;

    this._buildSpectrum(); this._wireSource(); this._wirePlayPause();
    this._wireMenus(); this._wirePresets(); this._wireSlider();
    this._wireWindow(); this._wireRetro(); this._wireAuto();
    this._wirePin(); this._wireRecord(); this._wireShaderEditor();
    this._wireVisibility(); this._wireKeyboard();

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

  syncSource(kind) {
    for (const b of document.querySelectorAll('#source-seg .seg-btn')) {
      const match = b.dataset.src === kind;
      b.classList.toggle('active', match);
      b.setAttribute('aria-pressed', String(match));
    }
    this.setPlayState(this._isPlaying ?? true, kind === 'file');
  }

  setTheme(name) {
    const t = THEMES[name];
    if (!t) return;
    this._css.setProperty('--acc-a', rgbToHex(t.a));
    this._css.setProperty('--acc-b', rgbToHex(t.b));
    this._css.setProperty('--acc-mix', rgbToHex(t.a.map((v, i) => (v + t.b[i]) / 2)));
    this._selectMenuItem('theme', name);
  }

  /** Advances to the next (or, with step -1, previous) visualizer in the preset order. */
  cycleViz(step = 1) {
    const cur = this._menus.viz.pop.querySelector('[aria-checked="true"]')?.dataset.value ?? VIZ_ORDER[0];
    const idx = VIZ_ORDER.indexOf(cur);
    const next = VIZ_ORDER[(idx + step + VIZ_ORDER.length) % VIZ_ORDER.length];
    this.syncViz(next); this._on.onViz(next);
    return next;
  }

  cycleTheme(step = 1) {
    const names = Object.keys(THEMES);
    const cur = this._menus.theme.pop.querySelector('[aria-checked="true"]')?.dataset.value ?? 'neon';
    const idx = names.indexOf(cur);
    const next = names[(idx + step + names.length) % names.length];
    this.setTheme(next); this._on.onTheme(next);
    this._flashHint(`Color · <b>${next}</b>`);
    return next;
  }

  setSectionTag(section) {
    if (!this._sectionTag || section === this._lastSection) return;
    this._lastSection = section;
    this._sectionTag.textContent = section ? `· ${section.toUpperCase()}` : '';
  }

  setRecordingState(active) {
    this._recBtn?.classList.toggle('recording', !!active);
    this._recBtn?.classList.toggle('active', !!active);
    this._recBtn?.setAttribute('aria-pressed', String(!!active));
  }

  setShaderSource(source) {
    if (this._shaderSource) this._shaderSource.value = source ?? '';
    if (this._shaderError) this._shaderError.textContent = '';
    this._renderShaderLibrary();
  }

  react(bins, energy, beat, details = {}) {
    const kick = details.kick ?? (beat ? 1 : 0);
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

    if (this._collapsed || this._idle) return;
    for (let i = 0; i < SPECTRUM_BARS; i++) {
      const src = Math.floor((i / SPECTRUM_BARS) * (bins.length - 1));
      let v = 0;
      for (let j = src; j < src + 4 && j < bins.length; j++) v = Math.max(v, bins[j]);
      const prev = this._smooth[i];
      this._smooth[i] = v > prev ? v : prev * 0.82 + v * 0.18;
      this._sbars[i].style.transform = `scaleY(${(0.04 + this._smooth[i] * 0.96).toFixed(3)})`;
    }
  }

  _buildSpectrum() {
    const wrap = document.getElementById('dock-spectrum');
    this._sbars = []; this._smooth = new Float32Array(SPECTRUM_BARS);
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
        this.syncSource(btn.dataset.src);
        this._on.onSource(btn.dataset.src);
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
      // No menuitem children (it's a search + list, not a radio menu) — the
      // generic open/close/outside-click/Escape handling below still applies.
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
        if (e.key === 'Escape') { e.preventDefault(); this._toggleMenu(null); m.trigger.focus(); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
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
        // Leaving the mode hides the panel via CSS regardless, but without this
        // the library popover would still think it's open (aria-expanded, the
        // outside-click handler) and silently reappear next time it's reachable.
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
    document.getElementById('btn-minimize')?.addEventListener('click', () => api?.windowMinimize());
    document.getElementById('btn-maximize')?.addEventListener('click', () => api?.windowMaximize());
    document.getElementById('btn-close')?.addEventListener('click', () => api?.windowClose());
    document.getElementById('btn-fullscreen')?.addEventListener('click', () => this._toggleFullscreen());
    if (!api) document.getElementById('chrome-zone').style.display = 'none';

    const setFsState = isFs => {
      const active = !!isFs;
      document.body.classList.toggle('is-fullscreen', active);
      document.getElementById('btn-fullscreen')?.setAttribute('aria-pressed', String(active));
    };

    api?.onFullscreenChange?.(setFsState);
    api?.windowIsFullscreen?.().then(setFsState);
    document.addEventListener('fullscreenchange', () => setFsState(!!document.fullscreenElement));
    window.addEventListener('resize', () => {
      if (api?.windowIsFullscreen) api.windowIsFullscreen().then(setFsState);
      else setFsState(!!document.fullscreenElement || (window.innerHeight >= screen.height && window.innerWidth >= screen.width));
    });
  }

  async _toggleFullscreen() {
    if (window.electronAPI) {
      try {
        const isFs = await window.electronAPI.windowFullscreenToggle();
        if (typeof isFs === 'boolean') {
          document.body.classList.toggle('is-fullscreen', isFs);
          document.getElementById('btn-fullscreen')?.setAttribute('aria-pressed', String(isFs));
        }
      } catch (err) { console.error('[ui] windowFullscreenToggle error:', err); }
      return;
    }
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); document.body.classList.remove('is-fullscreen'); }
      else { await document.documentElement.requestFullscreen(); document.body.classList.add('is-fullscreen'); }
    } catch { this._flashHint('Fullscreen is unavailable in this browser.'); }
  }

  _wireRetro() {
    this._retroOn = true;
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
    // The search box lives inside the popover's keydown listener (menu arrow-key
    // navigation, wired in _wireMenus) — stop those keys short of it so Home/End/
    // arrows still move the text cursor instead of being treated as menu commands.
    this._shaderLibrarySearch?.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { this._toggleMenu(null); this._shaderLibraryTrigger?.focus(); }
    });
    this._shaderLibrarySearch?.addEventListener('input', () => this._renderShaderLibrary());
    // Delegated so newly-rendered rows (added/removed by save/rename/delete) need no re-wiring.
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
    const res = this._on.onShaderApply?.(src);
    if (res && !res.ok) {
      if (this._shaderError) this._shaderError.textContent = res.error || 'Shader failed to compile.';
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
    const res = this._on.onShaderApply?.(entry.source);
    if (res && !res.ok) {
      if (this._shaderError) this._shaderError.textContent = res.error || 'Shader failed to compile.';
    } else {
      if (this._shaderError) this._shaderError.textContent = '';
      this._flashHint(`Loaded <b>${entry.name}</b>`);
      saveLastSource(entry.source);
      // Closing the outside-click listener no longer does this for us (rename/
      // delete/search need clicks inside the popover to NOT close it) — so a
      // successful load closes it explicitly, matching viz/theme menu-item feel.
      this._toggleMenu(null);
    }
    this._renderShaderLibrary();
  }

  /** Renames a saved shader in place, replacing its row with a text input until Enter/blur (or Escape to cancel). */
  _commitShaderRename(id, input, cancelled) {
    if (!cancelled) renameShader(id, input.value);
    this._renamingShaderId = null;
    this._renderShaderLibrary();
  }

  /** Rebuilds the saved-shaders list, filtered by the search box and highlighting the current editor text. */
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
    const act = () => this._markActivity();
    ['mousemove', 'mousedown', 'wheel'].forEach(ev => window.addEventListener(ev, act, ev === 'wheel' ? { passive: true } : undefined));
    this._root.addEventListener('focusin', act);
    this._root.addEventListener('mouseenter', () => clearTimeout(this._idleTimer));
    this._root.addEventListener('mouseleave', () => this._scheduleIdle());
  }

  _wireKeyboard() {
    window.addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === 'h') this._setCollapsed(!this._collapsed);
      else if (k === ' ' || k === 'space') { if (this._on.onPlayPause) { e.preventDefault(); this._on.onPlayPause(); } }
      else if (k === 'f') this._toggleFullscreen();
      else if (k === 'escape') { if (document.body.classList.contains('is-fullscreen')) { e.preventDefault(); this._toggleFullscreen(); } }
      else if (k === 'r') this._toggleRetro();
      else if (k === 'c') this.cycleTheme(1);
      else if (k === '[' || k === ']') {
        const step = k === ']' ? 0.15 : -0.15;
        this._sensEl.value = Math.min(4, Math.max(0.1, this.sensitivity + step)).toFixed(2);
        this._syncSlider();
        this._flashHint(`Sensitivity · <b>${this.sensitivity.toFixed(1)}×</b>`);
      } else if (e.key >= '1' && e.key <= String(VIZ_ORDER.length)) {
        const value = VIZ_ORDER[+e.key - 1];
        this.syncViz(value); this._on.onViz(value);
        this._flashHint(`<b>${this._menus.viz.valueEl.textContent}</b>`);
      } else { return; }
      this._markActivity();
    });
  }

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
