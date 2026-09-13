# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primarily the developer's own personal use — a solo-built tool the author runs
themself while listening to music. The project is public on GitHub (open
source, no gatekeeping), so strangers may clone and run it, but it was not
built with onboarding a general public audience as a goal. Design and UX
priorities should favor the creator's own daily use over first-time-stranger
hand-holding, while not actively breaking for someone who does clone it.

## Product Purpose

Afterimage is a real-time, audio-reactive music visualizer: it captures
whatever audio the computer is playing (system loopback or mic), analyzes it
(FFT, beat detection, song-section/drop detection), and drives WebGL
shader-based visuals from that analysis live, with no prerecorded video.
Success is a visually striking, responsive foreground experience that reacts
convincingly to the actual music.

## Positioning

A standalone desktop app (Electron) that needs no browser extension, no
account, no cloud service, and no API keys to work: system audio capture is
native (WASAPI on Windows), analysis and rendering happen entirely on-device,
and the optional Spotify integration is a read-only, user-supplied OAuth PKCE
connection (no shared client secret, no server in the loop) used only for
metadata (track/artist/position/cover art) — never audio. This is meaningfully
different from browser-based or plugin-based visualizers that require a
tab/extension or a hosted backend.

## Operating Context

Used in the foreground: the visuals are the primary thing being looked at
(e.g. focused/relaxed music listening), typically fullscreen. The app also
supports being controlled via system tray or global hotkeys while
unfocused, but the dominant, designed-for scenario is foreground viewing,
not background/overlay use.

Primary OS is Windows (WASAPI loopback works out of the box); macOS and Linux
are supported but require the user to configure a loopback device manually
(BlackHole / PulseAudio-Pipewire monitor).

## Capabilities and Constraints

- 9 live shader-based visualizers (Bars, Orb, Particles, Morphing Forms, Neon
  Wormhole, EXC3 Motion, Bass Impulse, Live Shader, Album Aura), Three.js/WebGL,
  no bundler (plain ES module relative imports).
- Live Shader mode: user-editable GLSL on a full-screen quad, validated by a
  scratch WebGL compile before being applied; a saved-shader library
  (localStorage-only, nothing leaves the machine) with rename/search.
- Album Aura: color palette (and now album art imagery) extracted live from
  Spotify's cover art via canvas pixel sampling; deliberately isolated from
  the app's global Neon/Fire/Ocean/etc. theme system in both directions.
- Spotify connection is optional, read-only (now-playing + position only, no
  playback control), and requires the user to register their own free Spotify
  app and paste their own Client ID into a gitignored `config/spotify.json` —
  there is no shared/baked-in key.
- Electron with `nodeIntegration:false` + `contextIsolation:true`; all
  privileged access goes through `preload.js`'s contextBridge.
- Session recording to `.webm`, system tray controls, and global hotkeys
  that work while the window is unfocused.
- No known photosensitivity/accessibility constraint has been raised; visuals
  are beat-reactive but this has not been flagged as a concern to design
  around.

## Brand Commitments

Name: **Afterimage** (subtitle "— Music Visualizer" in the README/app
identity). An existing wordmark/logo image and real app screenshots are
already embedded at the top of README.md — treat those as the current visual
identity baseline, not something to reinvent without cause.

## Evidence on Hand

Real screenshots of the running app are embedded in README.md (top of file).
No fabricated testimonials, benchmarks, or customer claims exist and none
should be introduced.

## Product Principles

- Everything runs locally, on-device — no server, no telemetry, no required
  account; optional integrations (Spotify) stay read-only and user-configured.
- The music genuinely drives the visuals (real FFT/beat/section analysis),
  never a canned animation loop dressed up as reactive.
- Power-user control surfaces (Live Shader, saved shader library, global
  hotkeys, tray) matter more here than first-run hand-holding, since the
  primary user is the app's own author.
- New visual modes stay isolated from each other's state (e.g. Album Aura's
  palette/theme independence) rather than sharing global mutable style state.
- Foreground visual impact is the priority the UI chrome should stay out of
  the way of — controls exist to be summoned (`H` to hide), not to dominate.
