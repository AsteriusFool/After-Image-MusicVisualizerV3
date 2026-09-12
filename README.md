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

- **9 visualizers** — Bars, Orb, Particles, Morphing Forms, Neon Wormhole, EXC3 Motion,
  Bass Impulse, Live Shader, and Album Aura — cycled with number keys, the preset bank, or
  the Visualizer dropdown.
- **Album Aura** — a dedicated visualizer whose entire color palette comes from the cover
  art of whatever's currently playing on Spotify, extracted live by sampling the image's
  pixels (no server round trip). Fully isolated from the app's Neon/Fire/Ocean… theme
  system in both directions — switching that theme elsewhere never affects Album Aura, and
  Album Aura's colors never leak into any other visualizer. Needs the Spotify connection
  below; shows a fixed default palette until a track's colors arrive.
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
- **Spotify companion connection** (optional, read-only) — shows what's currently playing
  on Spotify and its exact position, and feeds Album Aura's live palette. This is metadata
  only, never audio: Spotify's API doesn't expose track audio to third-party apps. Once
  connected, System Audio capture starts on its own the moment Spotify reports playback —
  no separate manual source click needed — as long as nothing else (like Mic) is already
  selected. See **Connecting Spotify** below to set it up.

---

## Connecting Spotify (optional)

The "Connect Spotify" button next to the audio-source picker needs your own free Spotify
app registration — there's no shared key baked into the app, so this is a one-time setup:

1. Create a free app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. In that app's settings, add `http://127.0.0.1:8888/callback` as a Redirect URI.
3. Copy `config/spotify.example.json` to `config/spotify.json` (already gitignored — it
   never gets committed) and paste in that app's **Client ID**.
4. Click **Connect Spotify** in the app — it opens your browser for a one-time login and
   approval, then returns you to Afterimage.

No Client Secret is needed or used; this uses the OAuth PKCE flow, the correct approach
for a desktop app since there's nowhere safe to hide a traditional secret in a shipped
binary. The connection only requests read-only scopes (what's playing, and its position)
— it cannot control playback.

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
| **Visualizer** dropdown / preset bank | Choose Bars, Orb, Particles, Morphing Forms, Neon Wormhole, EXC3 Motion, Bass Impulse, Live Shader, or Album Aura |
| **Color** dropdown | Choose Neon, Fire, Ocean, Aurora, Sunset, Ice, Toxic, or Candy |
| **Sensitivity** slider | Scale FFT amplitude (0.1 – 4×) |
| **CRT** button | Toggle the retro CRT scanline look |
| **AUTO** button | Toggle Auto-Director (auto-switch visualizer on song drops) |
| **PIN** button | Toggle always-on-top |
| **REC** button | Start/stop recording the session to a `.webm` file |
| **Shader panel** (Live Shader mode) | Edit GLSL, Apply (`Ctrl/Cmd+Enter`), Reset, Save, and open the saved-shader Library popover (search + rename + load) |
| `1`–`9` | Jump directly to a visualizer |
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
├── spotify-auth.js            Spotify OAuth (PKCE) + now-playing polling — main process only
├── package.json
├── config/
│   └── spotify.example.json   Template — copy to spotify.json (gitignored) with your own Client ID
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
    ├── album-color.js         Extracts a color palette from an album-art image (canvas pixel sampling)
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
    │   ├── custom.js          Live Shader — user GLSL on a full-screen quad
    │   └── aura.js            Album Aura — colors driven by Spotify's cover art
    └── shaders/
        ├── bars.glsl.js
        ├── orb.glsl.js        (includes simplex noise GLSL)
        ├── particles.glsl.js
        ├── random.glsl.js
        ├── speaker.glsl.js
        ├── exc3.glsl.js
        ├── impulse.glsl.js
        └── aura.glsl.js
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
| Spotify uses OAuth PKCE, no Client Secret | A shipped desktop app can't safely hide a traditional secret — PKCE is the standard, correct flow for native/desktop clients |
| Spotify tokens stored in Electron's userData dir, not the repo | Keeps per-user login state out of git entirely, separate from the gitignored-but-still-local `config/spotify.json` Client ID |
| Spotify connection is metadata-only | The Spotify API never exposes track audio to third-party apps — System Audio loopback remains the actual audio source for every visual |
| Album Aura's `setTheme()` is a no-op | Keeps it fully isolated from the app's global color-theme system in both directions, as requested — only `setPalette()` (from album art) ever sets its colors |
| Album art palette extracted via canvas pixel sampling, not a library | Spotify's cover-art CDN serves images with permissive CORS headers, so drawing to an offscreen canvas and reading pixels is enough — no image-processing dependency needed |
| System Audio auto-starts once Spotify reports playback | Removes the need to separately click a source after connecting Spotify — but only when no source is already selected, so it never overrides a manual choice |

---

## License

MIT
