/**
 * MCP OAuth flow orchestrator.
 *
 * Glues the pure protocol helpers in `mcp-oauth.ts` to the side-effectful
 * parts we need in a desktop app: spawning a loopback HTTP listener to catch
 * the authorization-code redirect, opening the user's browser, and enforcing
 * a time budget so a user who walks away from the browser can't wedge the
 * install indefinitely.
 *
 * The orchestrator returns an `McpOAuthState` ready to be persisted on the
 * `mcp_connections.config.oauth` field; the caller writes to the DB and
 * re-materialises `.mcp.json`.
 */

import http from 'http';
import type { AddressInfo } from 'net';
import type { McpOAuthState } from '../../core/types.js';
import {
  probeMcpAuth,
  fetchProtectedResourceMetadata,
  fetchAuthorizationServerMetadata,
  registerClient,
  generatePkce,
  randomState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  computeExpiry,
  type AuthorizationServerMetadata,
} from './mcp-oauth.js';

export interface OAuthFlowStatus {
  phase: 'probing' | 'discovering' | 'registering' | 'awaiting_user' | 'exchanging' | 'done' | 'error';
  message: string;
  authUrl?: string;              // present on phase === 'awaiting_user'
}

export type OAuthFlowLogger = (status: OAuthFlowStatus) => void;

export interface OAuthFlowOptions {
  mcpUrl: string;
  clientName?: string;           // displayed in the consent screen / admin UI
  timeoutMs?: number;            // budget for the entire flow; default 5 min
  openUrl?: (url: string) => void | Promise<void>;  // e.g. shell.openExternal
  onStatus?: OAuthFlowLogger;
}

export interface OAuthFlowResult {
  state: McpOAuthState;
}

// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export async function runMcpOAuthFlow(opts: OAuthFlowOptions): Promise<OAuthFlowResult> {
  const emit = (s: OAuthFlowStatus): void => { opts.onStatus?.(s); };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const clientName = opts.clientName ?? 'SEO Automator';

  const ctrl = new AbortController();
  const deadline = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);

  try {
    emit({ phase: 'probing', message: `Probing ${opts.mcpUrl}…` });
    const probe = await probeMcpAuth(opts.mcpUrl, ctrl.signal);
    if (!probe.requiresAuth) {
      throw new Error('Server did not challenge for OAuth — nothing to do');
    }
    const metadataUrl = probe.challenge?.resourceMetadataUrl;
    if (!metadataUrl) {
      throw new Error('WWW-Authenticate missing resource_metadata hint — non-compliant server');
    }

    emit({ phase: 'discovering', message: 'Discovering authorization server…' });
    const resource = await fetchProtectedResourceMetadata(metadataUrl, ctrl.signal);
    const issuer = resource.authorization_servers[0];
    if (!issuer) throw new Error('Resource metadata lists no authorization servers');
    const asMeta = await fetchAuthorizationServerMetadata(issuer, ctrl.signal);
    validateAuthorizationServer(asMeta);
    const resourceUri = resource.resource || opts.mcpUrl;

    // ---- Loopback listener ----------------------------------------------
    const callback = await startCallbackServer(ctrl.signal);
    const redirectUri = `http://127.0.0.1:${callback.port}/callback`;

    // ---- Dynamic registration -------------------------------------------
    if (!asMeta.registration_endpoint) {
      callback.close();
      throw new Error('Authorization server does not support dynamic client registration');
    }
    emit({ phase: 'registering', message: 'Registering client…' });
    const registered = await registerClient(
      asMeta.registration_endpoint,
      { redirectUri, clientName, scope: firstOf(resource.scopes_supported) ?? undefined },
      ctrl.signal,
    );

    // ---- Build authorize URL --------------------------------------------
    const pkce = generatePkce();
    const state = randomState();
    const scope = firstOf(resource.scopes_supported) ?? firstOf(asMeta.scopes_supported);
    const authUrl = buildAuthorizeUrl({
      authorizationEndpoint: asMeta.authorization_endpoint,
      clientId: registered.client_id,
      redirectUri,
      codeChallenge: pkce.codeChallenge,
      state,
      scope,
      resource: resourceUri,
    });

    emit({ phase: 'awaiting_user', message: 'Waiting for browser sign-in…', authUrl });

    // Opening the browser is best-effort; if it fails (e.g. running the
    // standalone API server with no Electron shell), the status line carries
    // the URL so the frontend can open it with window.open or print it.
    if (opts.openUrl) {
      try { await opts.openUrl(authUrl); }
      catch (err) { emit({ phase: 'awaiting_user', message: `Could not auto-open browser: ${(err as Error).message}`, authUrl }); }
    }

    // ---- Wait for callback ----------------------------------------------
    const cb = await callback.awaitCallback();
    if (cb.error) throw new Error(`Authorization denied: ${cb.error}${cb.errorDescription ? ` — ${cb.errorDescription}` : ''}`);
    if (!cb.code) throw new Error('Authorization callback arrived without a code');
    if (cb.state !== state) throw new Error('state mismatch — possible CSRF, aborting');

    // ---- Exchange --------------------------------------------------------
    emit({ phase: 'exchanging', message: 'Exchanging code for tokens…' });
    const tokens = await exchangeCodeForToken({
      tokenEndpoint: asMeta.token_endpoint,
      code: cb.code,
      redirectUri,
      codeVerifier: pkce.codeVerifier,
      clientId: registered.client_id,
      clientSecret: registered.client_secret ?? null,
      resource: resourceUri,
    }, ctrl.signal);

    const oauthState: McpOAuthState = {
      issuer: asMeta.issuer,
      authorizationEndpoint: asMeta.authorization_endpoint,
      tokenEndpoint: asMeta.token_endpoint,
      registrationEndpoint: asMeta.registration_endpoint ?? null,
      clientId: registered.client_id,
      clientSecret: registered.client_secret ?? null,
      redirectUri,
      scope: tokens.scope ?? scope ?? null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      tokenType: tokens.token_type || 'Bearer',
      accessTokenExpiresAt: computeExpiry(tokens.expires_in),
      resource: resourceUri,
      lastRefreshError: null,
    };

    emit({ phase: 'done', message: 'Authorization complete.' });
    return { state: oauthState };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    emit({ phase: 'error', message: msg });
    throw err;
  } finally {
    clearTimeout(deadline);
  }
}

// ---------------------------------------------------------------------------
// Callback server
// ---------------------------------------------------------------------------

interface CallbackServer {
  port: number;
  awaitCallback: () => Promise<{ code?: string; state?: string; error?: string; errorDescription?: string }>;
  close: () => void;
}

function startCallbackServer(signal: AbortSignal): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let resolveCb: ((r: { code?: string; state?: string; error?: string; errorDescription?: string }) => void) | null = null;
    let rejectCb: ((err: Error) => void) | null = null;
    let handled = false;

    const server = http.createServer((req, res) => {
      // Ignore favicon and any non-/callback hits.
      if (!req.url || !req.url.startsWith('/callback')) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      if (handled) {
        res.statusCode = 409;
        res.end('Callback already received');
        return;
      }
      handled = true;

      const u = new URL(req.url, `http://127.0.0.1`);
      const code = u.searchParams.get('code') ?? undefined;
      const returnedState = u.searchParams.get('state') ?? undefined;
      const error = u.searchParams.get('error') ?? undefined;
      const errorDescription = u.searchParams.get('error_description') ?? undefined;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(renderCallbackPage(!!error));

      resolveCb?.({ code, state: returnedState, error, errorDescription });
      // Close after the response flushes so the browser renders something.
      setTimeout(() => server.close(), 250);
    });

    server.on('error', (err) => { rejectCb?.(err); reject(err); });

    signal.addEventListener('abort', () => {
      if (!handled) rejectCb?.(new Error('OAuth flow timed out or was cancelled'));
      server.close();
    }, { once: true });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        awaitCallback: () => new Promise((r, rj) => { resolveCb = r; rejectCb = rj; }),
        close: () => server.close(),
      });
    });
  });
}

function renderCallbackPage(error: boolean): string {
  const title = error ? 'Authorization failed' : 'Authorization complete';
  const body = error
    ? 'Something went wrong. You can close this tab and try the install again from SEO Automator.'
    : 'You can close this tab and return to SEO Automator.';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; display: flex; min-height: 100vh; align-items: center; justify-content: center; background: #F7F7F8; color: #1A1A1E; }
  .card { background: #fff; padding: 32px 40px; border-radius: 16px; box-shadow: 0 10px 40px -10px rgba(0,0,0,0.15); max-width: 380px; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 18px; }
  p { margin: 0; color: #64646A; font-size: 13px; }
</style>
</head><body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

// ---------------------------------------------------------------------------

function firstOf(a: string[] | undefined): string | null {
  return a && a.length ? a[0] : null;
}

function validateAuthorizationServer(m: AuthorizationServerMetadata): void {
  if (!m.authorization_endpoint.startsWith('https://')) {
    throw new Error('Authorization endpoint must be HTTPS');
  }
  if (!m.token_endpoint.startsWith('https://')) {
    throw new Error('Token endpoint must be HTTPS');
  }
  const pkceMethods = m.code_challenge_methods_supported;
  if (pkceMethods && !pkceMethods.includes('S256')) {
    throw new Error('Authorization server does not advertise PKCE S256');
  }
}

// ---------------------------------------------------------------------------
// Refresh (thin wrapper used by the background refresher)
// ---------------------------------------------------------------------------

import { refreshAccessToken } from './mcp-oauth.js';

export async function refreshMcpOAuth(prev: McpOAuthState): Promise<McpOAuthState> {
  if (!prev.refreshToken) throw new Error('No refresh token — re-auth required');
  const tokens = await refreshAccessToken({
    tokenEndpoint: prev.tokenEndpoint,
    refreshToken: prev.refreshToken,
    clientId: prev.clientId,
    clientSecret: prev.clientSecret ?? null,
    scope: prev.scope,
    resource: prev.resource,
  });
  return {
    ...prev,
    accessToken: tokens.access_token,
    // Servers MAY rotate refresh tokens; prefer the new one if present.
    refreshToken: tokens.refresh_token ?? prev.refreshToken,
    tokenType: tokens.token_type || prev.tokenType,
    accessTokenExpiresAt: computeExpiry(tokens.expires_in),
    lastRefreshError: null,
  };
}
