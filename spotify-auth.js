'use strict';

/**
 * Spotify "now playing" companion connection — main-process only (needs
 * Node's http/crypto/fs, none of which the renderer has direct access to).
 *
 * This deliberately does NOT capture audio: Spotify's API never exposes
 * track audio to third-party apps, only metadata and (with a wider scope,
 * not requested here) playback control. The actual sound you hear still
 * comes from System Audio loopback exactly as before — this just tells the
 * app which track that sound is and exactly where in it, so features like
 * accurate lyrics sync or album-art-driven visuals have something real to
 * key off instead of guessing from a filename.
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

const { app, shell } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
// Read-only: what's playing + its position. No playback-control scope requested.
const SCOPES = 'user-read-currently-playing user-read-playback-state';
const AUTH_TIMEOUT_MS = 120000;

let cachedTokens = null; // { accessToken, refreshToken, expiresAt }

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

function saveTokens(tokenResponse, fallbackRefreshToken) {
  const data = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token || fallbackRefreshToken,
    // Refresh a little early so a request never races an expiring token.
    expiresAt: Date.now() + (tokenResponse.expires_in * 1000) - 30000,
  };
  try {
    fs.mkdirSync(path.dirname(tokenFilePath()), { recursive: true });
    fs.writeFileSync(tokenFilePath(), JSON.stringify(data), 'utf8');
  } catch (err) {
    console.error('[spotify-auth] failed to persist tokens:', err.message);
  }
  cachedTokens = data;
  return data;
}

function loadPersistedTokens() {
  try {
    return JSON.parse(fs.readFileSync(tokenFilePath(), 'utf8'));
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

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body style="font-family:sans-serif;background:#191917;color:#eee;text-align:center;padding:60px">
        <h2>${ok ? 'Spotify connected' : 'Spotify connection failed'}</h2>
        <p>${ok ? 'You can close this tab and go back to Afterimage.' : (error || 'Could not verify this login — please try again.')}</p>
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

module.exports = { connect, disconnect, getStatus, getNowPlaying };
