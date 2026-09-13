'use strict';

/**
 * Spotify "now playing" companion connection — main-process only (needs
 * Node's http/crypto/fs, none of which the renderer has direct access to).
 *
 * This deliberately does NOT capture audio: Spotify's API never exposes
 * track audio to third-party apps, only metadata and playback control. The
 * actual sound you hear still comes from System Audio loopback exactly as
 * before — this just tells the app which track that sound is and exactly
 * where in it (for album-art-driven visuals), and lets it send play/pause/
 * skip/seek commands to whichever device Spotify Connect currently has
 * active. Playback control requires a Spotify Premium account — Spotify's
 * API rejects it for Free accounts regardless of what this app does.
 *
 * Auth flow: OAuth 2.0 Authorization Code with PKCE — the correct flow for
 * a desktop app, since there's nowhere safe to hide a traditional Client
 * Secret in a shipped binary. No secret is used or needed. A one-time
 * browser popup asks the user to approve read-only access; a small local
 * HTTP server (127.0.0.1 only, closed immediately after) catches the
 * redirect Spotify sends back with the authorization code.
 *
 * Setup (one-time, in your Spotify account — see config/spotify.example.json):
 *   1. Create a free app at https://developer.spotify.com/dashboard
 *   2. Add http://127.0.0.1:8888/callback as a Redirect URI on that app
 *   3. Copy config/spotify.example.json to config/spotify.json with your Client ID
 */

const { app, shell, safeStorage } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
// What's playing + its position, plus playback control (play/pause/skip/seek).
const SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';
const AUTH_TIMEOUT_MS = 120000;

let cachedTokens = null; // { accessToken, refreshToken, expiresAt }

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateVerifier() {
  return base64url(crypto.randomBytes(64));
}

function generateChallenge(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

/** Reads the user's own Client ID from the gitignored local config file. Never throws. */
function loadClientId() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'config', 'spotify.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const id = typeof parsed.clientId === 'string' ? parsed.clientId.trim() : '';
    return id && id !== 'YOUR_SPOTIFY_CLIENT_ID' ? id : null;
  } catch (_) {
    return null;
  }
}

function tokenFilePath() {
  return path.join(app.getPath('userData'), 'spotify-tokens.json');
}

/**
 * Tokens are encrypted at rest with Electron's `safeStorage` (OS keychain —
 * DPAPI on Windows, Keychain on macOS, libsecret on Linux) so a plain
 * filesystem read of userData doesn't hand over a working Spotify session.
 * Falls back to plaintext only on the rare platform where OS encryption
 * isn't available (e.g. a Linux box with no secret-service running).
 */
function saveTokens(tokenResponse, fallbackRefreshToken) {
  const data = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token || fallbackRefreshToken,
    // Refresh a little early so a request never races an expiring token.
    expiresAt: Date.now() + (tokenResponse.expires_in * 1000) - 30000,
  };
  try {
    fs.mkdirSync(path.dirname(tokenFilePath()), { recursive: true });
    const json = JSON.stringify(data);
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(tokenFilePath(), safeStorage.encryptString(json));
    } else {
      fs.writeFileSync(tokenFilePath(), json, 'utf8');
    }
  } catch (err) {
    console.error('[spotify-auth] failed to persist tokens:', err.message);
  }
  cachedTokens = data;
  return data;
}

function loadPersistedTokens() {
  let raw;
  try {
    raw = fs.readFileSync(tokenFilePath());
  } catch (_) {
    return null;
  }
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return JSON.parse(safeStorage.decryptString(raw));
    } catch (_) {
      // Not encrypted yet (older plaintext file, or unrelated content) —
      // fall through and try reading it as plain JSON, then migrate below.
    }
  }
  try {
    const legacy = JSON.parse(raw.toString('utf8'));
    if (safeStorage.isEncryptionAvailable()) {
      // Silently upgrade a pre-existing plaintext token file to encrypted
      // storage the next time it's read.
      try { fs.writeFileSync(tokenFilePath(), safeStorage.encryptString(JSON.stringify(legacy))); } catch (_) {}
    }
    return legacy;
  } catch (_) {
    return null;
  }
}

function clearPersistedTokens() {
  cachedTokens = null;
  try { fs.unlinkSync(tokenFilePath()); } catch (_) {}
}

/**
 * Opens a short-lived local HTTP server to catch Spotify's OAuth redirect.
 * Resolves with the authorization code, or rejects on error/timeout/state
 * mismatch (the `state` round-trip guards against a forged redirect).
 */
function waitForAuthCode(expectedState) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { server.close(); } catch (_) {}
      if (err) reject(err); else resolve(code);
    };

    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url, `http://127.0.0.1:${REDIRECT_PORT}`);
      if (parsed.pathname !== '/callback') { res.writeHead(404); res.end(); return; }

      const code = parsed.searchParams.get('code');
      const error = parsed.searchParams.get('error');
      const state = parsed.searchParams.get('state');
      const ok = !error && code && state === expectedState;

      // `error` (and any other query param here) comes from the raw incoming
      // request to this loopback server, not from Spotify directly — a
      // malicious page could point a browser at this URL manually while the
      // server is briefly listening. Escape it before interpolating into
      // HTML so that can't become a reflected-XSS payload.
      const safeMessage = ok
        ? 'You can close this tab and go back to Afterimage.'
        : escapeHtml(error || 'Could not verify this login — please try again.');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body style="font-family:sans-serif;background:#191917;color:#eee;text-align:center;padding:60px">
        <h2>${ok ? 'Spotify connected' : 'Spotify connection failed'}</h2>
        <p>${safeMessage}</p>
        </body></html>`);

      if (ok) finish(null, code);
      else finish(new Error(error || 'Spotify login could not be verified.'));
    });

    server.on('error', err => finish(err));
    server.listen(REDIRECT_PORT, '127.0.0.1');

    const timer = setTimeout(() => finish(new Error('Spotify login timed out.')), AUTH_TIMEOUT_MS);
  });
}

async function exchangeCodeForTokens(clientId, code, verifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Spotify token exchange failed (${res.status})`);
  return res.json();
}

async function refreshAccessToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Spotify token refresh failed (${res.status})`);
  return res.json();
}

/** Returns a currently-valid access token, refreshing it first if needed, or null if never connected. */
async function getValidAccessToken(clientId) {
  const tokens = cachedTokens || loadPersistedTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt) {
    cachedTokens = tokens;
    return tokens.accessToken;
  }
  const refreshed = await refreshAccessToken(clientId, tokens.refreshToken);
  return saveTokens(refreshed, tokens.refreshToken).accessToken;
}

async function fetchCurrentlyPlaying(accessToken) {
  const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 204) return null; // nothing currently playing
  if (!res.ok) throw new Error(`Spotify now-playing request failed (${res.status})`);
  const data = await res.json();
  if (!data || !data.item) return null;
  return {
    title: data.item.name,
    artist: (data.item.artists || []).map(a => a.name).join(', '),
    album: data.item.album?.name ?? '',
    albumArtUrl: data.item.album?.images?.[0]?.url ?? null,
    durationMs: data.item.duration_ms ?? 0,
    progressMs: data.progress_ms ?? 0,
    isPlaying: !!data.is_playing,
  };
}

/**
 * Sends a playback-control command to whichever device Spotify Connect
 * currently has active. Returns { ok, error } — never throws, since this is
 * called directly from renderer button clicks via IPC.
 */
async function sendPlaybackCommand(method, endpoint, body) {
  const clientId = loadClientId();
  if (!clientId) return { ok: false, error: 'Spotify is not configured.' };
  const accessToken = await getValidAccessToken(clientId);
  if (!accessToken) return { ok: false, error: 'Spotify is not connected.' };

  let res;
  try {
    res = await fetch(`https://api.spotify.com/v1/me/player${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (res.status === 204 || res.ok) return { ok: true, error: null };
  if (res.status === 404) return { ok: false, error: 'Nothing is currently playing on Spotify.' };
  if (res.status === 403) return { ok: false, error: 'Spotify Premium is required for playback control.' };
  if (res.status === 401) return { ok: false, error: 'Reconnect Spotify to enable playback control.' };
  return { ok: false, error: `Spotify playback command failed (${res.status}).` };
}

function play()     { return sendPlaybackCommand('PUT', '/play'); }
function pause()     { return sendPlaybackCommand('PUT', '/pause'); }
function next()      { return sendPlaybackCommand('POST', '/next'); }
function previous()  { return sendPlaybackCommand('POST', '/previous'); }
function seek(positionMs) {
  const ms = Math.max(0, Math.round(Number(positionMs) || 0));
  return sendPlaybackCommand('PUT', `/seek?position_ms=${ms}`);
}

/** Runs the full login flow: opens the system browser, waits for approval, stores tokens. */
async function connect() {
  const clientId = loadClientId();
  if (!clientId) {
    return { ok: false, error: 'No Spotify Client ID configured — see config/spotify.example.json.' };
  }

  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);
  const state = base64url(crypto.randomBytes(16));

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('state', state);

  try {
    const codePromise = waitForAuthCode(state);
    await shell.openExternal(authUrl.toString());
    const code = await codePromise;
    const tokens = await exchangeCodeForTokens(clientId, code, verifier);
    saveTokens(tokens, null);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function disconnect() {
  clearPersistedTokens();
}

function getStatus() {
  return {
    configured: !!loadClientId(),
    connected: !!(cachedTokens || loadPersistedTokens()),
  };
}

/** Resolves to the current track's info, or null if nothing's playing / not connected. */
async function getNowPlaying() {
  const clientId = loadClientId();
  if (!clientId) return null;
  const accessToken = await getValidAccessToken(clientId);
  if (!accessToken) return null;
  return fetchCurrentlyPlaying(accessToken);
}

module.exports = { connect, disconnect, getStatus, getNowPlaying, play, pause, next, previous, seek };
