<img width="1718" height="1272" alt="image" src="https://github.com/user-attachments/assets/d262996e-e0c1-4dd6-b951-07a79b17f701" />
<img width="1115" height="905" alt="image" src="https://github.com/user-attachments/assets/ee0a00a6-f619-4412-b84f-671786c0874e" />
<img width="1567" height="1010" alt="image" src="https://github.com/user-attachments/assets/9877fd1b-98c8-4a62-a69b-055fc1b7c29c" />
<img width="1297" height="1025" alt="image" src="https://github.com/user-attachments/assets/94820273-294f-4ab7-b568-c51fc46e9bc9" />


---

# Afterimage — Music Visualizer

A **universal music visualizer** for Windows (and macOS/Linux) that:
- Captures **system audio via WASAPI loopback** — whatever your computer is playing
- Runs a real-time **FFT** using the Web Audio API, plus energy/section (drop) detection
- Renders eight live shader-based visualizations with **Three.js / WebGL**, including a
  fully editable **Live Shader** mode with a saved-shader library
- Can **auto-switch visuals on song drops** (Auto-Director), **record the session to video**,
  **pin the window always-on-top**, and be driven from a **system tray icon** or **global
  hotkeys** even while unfocused
- Runs as a standalone **Electron** desktop app — no browser extension, no API keys

---

## Architecture

```
System Audio (WASAPI loopback)
        │
        ▼
  Electron desktopCapturer  ──►  getUserMedia({ chromeMediaSource:'desktop' })
        │
        ▼
  Web Audio AnalyserNode  (FFT size 4096 → 2048 bins)
        │
        ├── Beat detection      (energy-variance, Frédéric Patin algorithm)
        ├── Section detection   (dual-EMA ratio heuristic → intro/build/drop/peak/breakdown)
        ├── MediaStreamAudioDestinationNode  (tapped for session recording)
        └── 256-bin normalised frequency array
                │
                ▼
        THREE.DataTexture  (256×1 RGBA, updated every frame)
                │
                ▼
        WebGL ShaderMaterial / full-screen quad
          ├── Bars          — 128 InstancedMesh boxes
          ├── Orb           — IcosahedronGeometry + simplex noise displacement
          ├── Particles     — 8 000 toroidal Points with per-particle frequency bands
          ├── Morphing Forms, Neon Wormhole, EXC3 Motion — additional shader-driven modes
          ├── Bass Impulse  — InstancedMesh shard field with spring/damping physics,
          │                   kick-triggered impulses, radius-clamped containment
          └── Live Shader   — user-editable GLSL rendered on a Shadertoy-style
                              full-screen quad (own scene/camera, not a 3D mesh),
                              with telemetry uniforms (kick/bass/energy/beat/spectrum)
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18 LTS |
| npm | ≥ 9 |

---

## Setup & Run

```bash
# Install dependencies (also runs postinstall → copies three.module.js)
npm install

# Launch the app
npm start

# Development mode (opens DevTools)
npm run dev
```

### Repository notes

The repository intentionally excludes `node_modules/`, build output, generated
Three.js files, local logs, and screen recordings. After cloning the project,
run `npm install` to recreate the dependencies before starting the app.

Large media files should not be committed directly. If a media asset is needed
in the repository, use Git LFS:

```bash
git lfs install
git lfs track "*.mp4" "*.webm"
git add .gitattributes
git add -f path/to/needed-media.mp4
```

Then commit and push the tracked media file normally.

> **Windows**: System audio loopback works out-of-the-box via WASAPI.  
> **macOS**: Install [BlackHole](https://github.com/ExistentialAudio/BlackHole) and
>   set it as the system output; then choose "Microphone" and pick BlackHole.  
> **Linux**: Enable a PulseAudio/Pipewire loopback module; then select the monitor device.

---

## Features

- **8 visualizers** — Bars, Orb, Particles, Morphing Forms, Neon Wormhole, EXC3 Motion,
  Bass Impulse, and Live Shader — cycled with number keys, the preset bank, or the
  Visualizer dropdown.
- **Live Shader mode** — write and apply your own GLSL fragment shader on a full-screen
  quad (not mapped onto a sphere), with live telemetry uniforms for kick, bass, energy,
  beat, and a 256-bin frequency texture. Shaders are validated by compiling them in a
  scratch WebGL context before being applied, so a broken shader can't crash the mode.
- **Saved shader library** — save any shader you write under a name, reopen it later
  (button-triggered popover, not always shown), rename it in place, and search the list
  by name. The last-applied shader is restored automatically on next launch. Everything
  is stored locally (`localStorage`) — nothing leaves your machine.
- **Auto-Director** — optionally auto-switches to the next visualizer whenever the app
  detects a song "drop" (a sudden jump from a quieter section to a loud, kick-heavy one),
  so the visuals react to the structure of the track without manual input.
- **Session recording** — capture the canvas and the current audio together into a
  `.webm` video file with one click (REC button).
- **Always-on-top pin** — keep the window pinned above other apps (PIN button), useful
  for running it as a live overlay while doing something else.
- **System tray icon** — show/hide the window, play/pause, cycle visualizer, cycle color
  theme, toggle always-on-top, and quit — all from the tray, even when the window is hidden.
- **Global hotkeys** (work even when the app isn't focused): `Alt+Shift+P` play/pause,
  `Alt+Shift+]` / `Alt+Shift+[` next/previous visualizer, `Alt+Shift+C` next color theme.
- **True OS fullscreen** — the app launches straight into fullscreen so nothing (including
  the taskbar) shows behind it; press `F`/`Esc` to leave it.

---

## Build a distributable

```bash
npm run build       # Windows NSIS installer → dist/
```

---

## Controls

| Control | Action |
|---------|--------|
| **Audio Source** button | Switch between system loopback and microphone |
| **Visualizer** dropdown / preset bank | Choose Bars, Orb, Particles, Morphing Forms, Neon Wormhole, EXC3 Motion, Bass Impulse, or Live Shader |
| **Color** dropdown | Choose Neon, Fire, Ocean, Aurora, Sunset, Ice, Toxic, or Candy |
| **Sensitivity** slider | Scale FFT amplitude (0.1 – 4×) |
| **CRT** button | Toggle the retro CRT scanline look |
| **AUTO** button | Toggle Auto-Director (auto-switch visualizer on song drops) |
| **PIN** button | Toggle always-on-top |
| **REC** button | Start/stop recording the session to a `.webm` file |
| **Shader panel** (Live Shader mode) | Edit GLSL, Apply (`Ctrl/Cmd+Enter`), Reset, Save, and open the saved-shader Library popover (search + rename + load) |
| `1`–`8` | Jump directly to a visualizer |
| `H` | Hide/show the control panel |
| `F` / `Esc` | Toggle fullscreen |
| `Alt+Shift+P` | Play/Pause (global, works unfocused) |
| `Alt+Shift+]` / `Alt+Shift+[` | Next / previous visualizer (global) |
| `Alt+Shift+C` | Next color theme (global) |
| System tray icon | Show/hide, play/pause, next visualizer, next color, toggle always-on-top, quit |

---

## Project layout

```
MusicVisualizer/
├── main.js                    Electron main process — window, tray, global shortcuts,
│                               fullscreen IPC, always-on-top IPC
├── preload.js                 contextBridge API surface
├── package.json
├── scripts/
│   └── postinstall.js         Copies three.module.js → renderer/lib/
└── renderer/
    ├── index.html
    ├── style.css
    ├── app.js                 Entry — wires audio → visuals + UI, global shortcuts,
    │                           session recording, shader-library restore-on-startup
    ├── audio-capture.js       MediaStream acquisition (loopback / mic)
    ├── audio-analyzer.js      FFT + beat detection + song-section (drop) detection
    ├── visualizer.js          Three.js scene manager + DataTexture + render pipeline
    ├── shader-library.js      Saved-shader persistence (localStorage)
    ├── lib/
    │   └── three.module.js    (generated by postinstall — do not commit)
    ├── viz/
    │   ├── bars.js
    │   ├── orb.js
    │   ├── particles.js
    │   ├── random.js          Morphing Forms
    │   ├── speaker.js         Neon Wormhole
    │   ├── exc3.js            EXC3 Motion
    │   ├── impulse.js         Bass Impulse — physics-driven shard field
    │   └── custom.js          Live Shader — user GLSL on a full-screen quad
    └── shaders/
        ├── bars.glsl.js
        ├── orb.glsl.js        (includes simplex noise GLSL)
        ├── particles.glsl.js
        ├── random.glsl.js
        ├── speaker.glsl.js
        ├── exc3.glsl.js
        └── impulse.glsl.js
```

---

## Key design decisions

| Decision | Reason |
|----------|--------|
| No bundler | ES modules with direct relative imports work natively in Electron's Chromium renderer |
| `three.module.js` copied to `renderer/lib/` | Avoids bundler while keeping Three.js importable as a relative path |
| `nodeIntegration: false` + `contextIsolation: true` | Renderer has no Node.js access; all privileges go through `preload.js` contextBridge |
| `THREE.DataTexture` for FFT data | Passes 256 frequency bins to the GPU more efficiently than a `uniform float[256]` array |
| `THREE.AdditiveBlending` on all materials | Creates neon glow without post-processing passes |
| Frédéric Patin beat detection | Energy-variance adaptive threshold avoids hardcoded dB values |
| Dual-EMA ratio heuristic for section detection | A fast (0.35s) vs. slow (3s) energy EMA ratio, seeded from the first sample, detects drops robustly across differently-mastered tracks without hardcoded loudness thresholds |
| Live Shader renders on its own quad scene/camera | Keeps user GLSL a genuine full-screen effect (Shadertoy-style) instead of forcing it onto a 3D mesh |
| Saved shaders validated before use | Shaders are compiled in a scratch WebGL context before being applied or restored, so a broken/corrupted saved shader falls back to the default instead of breaking the mode |
| Shader library in `localStorage` | This is a real desktop window (`file://` origin), so `localStorage` persists across restarts with no main-process/IPC plumbing needed |
| Launches straight into OS fullscreen | Avoids a maximized-but-not-fullscreen window showing the Windows taskbar underneath |

---

## License

MIT
