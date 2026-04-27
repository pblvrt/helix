/**
 * MCP OAuth 2.1 client — protocol layer.
 *
 * Implements the discovery + PKCE + token flow from the MCP spec's
 * authorization addendum (Nov 2024) on top of RFC 8414 (authorization server
 * metadata), RFC 7591 (dynamic client registration), RFC 7636 (PKCE), and
 * RFC 8707 (resource indicators).
 *
 * This file is deliberately framework-free — no Electron, no Express, no
 * filesystem. The *flow* (opening a browser, catching the callback) lives in
 * `mcp-oauth-flow.ts`; this module only does protocol I/O.
 *
 * Verified against Smithery's `*.run.tools` hosted MCPs, which comply with the
 * spec except for one quirk: their auth server is published at an issuer URL
 * with a path component (e.g. `https://auth.smithery.ai/<qualifiedName>`), so
 * the RFC 8414 §3.1 "insert /.well-known/ before the path" variant matters.
 */

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// WWW-Authenticate parsing
// ---------------------------------------------------------------------------

export interface AuthChallenge {
  scheme: string;                                // "Bearer"
  params: Record<string, string>;                // error, error_description, resource_metadata, scope…
  resourceMetadataUrl: string | null;
}

/**
 * Parse an RFC 7235 `WWW-Authenticate` challenge. We don't need to handle
 * multi-challenge responses; MCP servers always reply with a single Bearer.
 */
export function parseWWWAuthenticate(header: string | null): AuthChallenge | null {
  if (!header) return null;
  const [scheme, rest] = splitFirst(header.trim(), ' ');
  if (!scheme) return null;
  const params: Record<string, string> = {};
  if (rest) {
    // key="value", key="value", ... (the spec also allows token form, but MCP servers quote)
    const re = /([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*"((?:\\.|[^"\\])*)"/g;
    for (let m = re.exec(rest); m; m = re.exec(rest)) {
      params[m[1].toLowerCase()] = m[2].replace(/\\(.)/g, '$1');
    }
  }
  return {
    scheme,
    params,
    resourceMetadataUrl: params.resource_metadata || null,
  };
}

function splitFirst(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + sep.length)];
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

export interface ProbeResult {
  requiresAuth: boolean;
  challenge: AuthChallenge | null;
  status: number;
}

/**
 * Send an MCP `initialize` request with no credentials to see if the server
 * issues a 401 and how. We use POST (streamable-HTTP transport); the old SSE
 * transport also 401s on first GET. We don't care which — either signal tells
 * us auth is required.
 */
export async function probeMcpAuth(url: string, signal?: AbortSignal): Promise<ProbeResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2024-11-05',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'seo-automator', version: '0.1' },
      },
    }),
    signal,
  });
  const challenge = parseWWWAuthenticate(res.headers.get('www-authenticate'));
  // Drain the body to free the socket; ignore content.
  try { await res.text(); } catch { /* noop */ }
  return {
    requiresAuth: res.status === 401 && challenge?.scheme.toLowerCase() === 'bearer',
    challenge,
    status: res.status,
  };
}

// ---------------------------------------------------------------------------
// Discovery (RFC 8414 + MCP resource metadata)
// ---------------------------------------------------------------------------

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  grant_types_supported?: string[];
  scopes_supported?: string[];
  response_types_supported?: string[];
}

export async function fetchProtectedResourceMetadata(url: string, signal?: AbortSignal): Promise<ProtectedResourceMetadata> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Resource metadata fetch failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<ProtectedResourceMetadata>;
}

/**
 * Discover the authorization server at `issuer`. RFC 8414 §3 defines two
 * well-known paths depending on whether the issuer has a path component:
 *
 *   issuer = https://auth.example.com          → https://auth.example.com/.well-known/oauth-authorization-server
 *   issuer = https://auth.example.com/tenant   → https://auth.example.com/.well-known/oauth-authorization-server/tenant
 *
 * Smithery's issuers have a path, so we need the second form. We also fall
 * back to the OpenID Connect discovery path.
 */
export async function fetchAuthorizationServerMetadata(issuer: string, signal?: AbortSignal): Promise<AuthorizationServerMetadata> {
  const u = new URL(issuer);
  const pathSuffix = u.pathname === '/' || u.pathname === '' ? '' : u.pathname.replace(/\/$/, '');
  const candidates = pathSuffix
    ? [
        `${u.origin}/.well-known/oauth-authorization-server${pathSuffix}`,
        `${u.origin}${pathSuffix}/.well-known/oauth-authorization-server`,
        `${u.origin}/.well-known/openid-configuration${pathSuffix}`,
        `${u.origin}${pathSuffix}/.well-known/openid-configuration`,
      ]
    : [
        `${u.origin}/.well-known/oauth-authorization-server`,
        `${u.origin}/.well-known/openid-configuration`,
      ];
  let lastErr: Error | null = null;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, { signal, headers: { Accept: 'application/json' } });
      if (!res.ok) { lastErr = new Error(`${candidate}: ${res.status}`); continue; }
      const body = await res.json() as AuthorizationServerMetadata;
      if (!body.authorization_endpoint || !body.token_endpoint) {
        lastErr = new Error(`${candidate}: missing endpoints`);
        continue;
      }
      return body;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw new Error(`Authorization server discovery failed for ${issuer}: ${lastErr?.message ?? 'no candidate succeeded'}`);
}

// ---------------------------------------------------------------------------
// Dynamic client registration (RFC 7591)
// ---------------------------------------------------------------------------

export interface RegisteredClient {
  client_id: string;
  client_secret?: string;
  token_endpoint_auth_method?: string;
  redirect_uris: string[];
}

export async function registerClient(
  registrationEndpoint: string,
  params: { redirectUri: string; clientName: string; scope?: string },
  signal?: AbortSignal,
): Promise<RegisteredClient> {
  const body = {
    client_name: params.clientName,
    redirect_uris: [params.redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'native',
    ...(params.scope ? { scope: params.scope } : {}),
  };
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Client registration failed: ${res.status} ${res.statusText} — ${detail.slice(0, 200)}`);
  }
  const registered = await res.json() as RegisteredClient;
  if (!registered.client_id) throw new Error('Registration response missing client_id');
  return registered;
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636)
// ---------------------------------------------------------------------------

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  method: 'S256';
}

export function generatePkce(): PkcePair {
  // 32 bytes → 43 chars base64url, within the 43-128 char window required.
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge, method: 'S256' };
}

export function randomState(): string {
  return crypto.randomBytes(16).toString('base64url');
}

// ---------------------------------------------------------------------------
// Authorize URL + token exchange
// ---------------------------------------------------------------------------

export function buildAuthorizeUrl(params: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope?: string | null;
  resource?: string;              // RFC 8707
}): string {
  const u = new URL(params.authorizationEndpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', params.clientId);
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('code_challenge', params.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', params.state);
  if (params.scope) u.searchParams.set('scope', params.scope);
  if (params.resource) u.searchParams.set('resource', params.resource);
  return u.toString();
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export async function exchangeCodeForToken(params: {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string | null;
  resource?: string;
}, signal?: AbortSignal): Promise<TokenResponse> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    client_id: params.clientId,
  });
  if (params.clientSecret) form.set('client_secret', params.clientSecret);
  if (params.resource) form.set('resource', params.resource);

  const res = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Token exchange failed: ${res.status} ${res.statusText} — ${detail.slice(0, 200)}`);
  }
  const body = await res.json() as TokenResponse;
  if (!body.access_token) throw new Error('Token response missing access_token');
  return body;
}

export async function refreshAccessToken(params: {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string | null;
  scope?: string | null;
  resource?: string;
}, signal?: AbortSignal): Promise<TokenResponse> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });
  if (params.clientSecret) form.set('client_secret', params.clientSecret);
  if (params.scope) form.set('scope', params.scope);
  if (params.resource) form.set('resource', params.resource);

  const res = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Refresh failed: ${res.status} ${res.statusText} — ${detail.slice(0, 200)}`);
  }
  const body = await res.json() as TokenResponse;
  if (!body.access_token) throw new Error('Refresh response missing access_token');
  return body;
}

export function computeExpiry(expiresIn: number | undefined, nowMs = Date.now()): string {
  // Default 1h if the server doesn't tell us — matches the MCP spec's suggested default.
  const seconds = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 3600;
  return new Date(nowMs + seconds * 1000).toISOString();
}
