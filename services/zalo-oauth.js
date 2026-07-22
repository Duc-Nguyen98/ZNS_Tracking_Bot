const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TOKEN_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', '.data');
const TOKEN_FILE = path.join(DATA_DIR, 'oa_tokens.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadTokenBundle() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveTokenBundle(payload = {}) {
  ensureDataDir();
  const now = Date.now();
  const expiresIn = Number(payload.expires_in || 0);
  const value = {
    ...payload,
    obtained_at: now,
    expires_at: expiresIn > 0 ? now + (expiresIn * 1000) : null
  };
  const temporaryFile = `${TOKEN_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryFile, TOKEN_FILE);
  return value;
}

function publicTokenStatus(bundle = loadTokenBundle()) {
  if (!bundle) return { configured: false };
  return {
    configured: Boolean(bundle.access_token),
    oa_id: bundle.oa_id || null,
    expires_in: bundle.expires_in || null,
    obtained_at: bundle.obtained_at || null,
    expires_at: bundle.expires_at || null,
    has_refresh_token: Boolean(bundle.refresh_token)
  };
}

function getAccessToken(explicitToken) {
  return explicitToken || loadTokenBundle()?.access_token || process.env.ZALO_ACCESS_TOKEN || null;
}

function assertOauthConfig() {
  const appId = process.env.ZALO_APP_ID;
  const appSecret = process.env.ZALO_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('Thiếu ZALO_APP_ID hoặc ZALO_APP_SECRET');
  }
  return { appId, appSecret };
}

function normalizeTokenResponse(responseData = {}) {
  if (responseData.error && Number(responseData.error) !== 0) {
    const error = new Error(responseData.message || `Zalo OAuth error ${responseData.error}`);
    error.code = responseData.error;
    throw error;
  }
  const payload = responseData.data && typeof responseData.data === 'object'
    ? responseData.data
    : responseData;
  if (!payload.access_token) throw new Error('Zalo OAuth không trả access_token');
  return payload;
}

async function requestToken(form) {
  const { appSecret } = assertOauthConfig();
  const response = await axios.post(
    TOKEN_URL,
    new URLSearchParams(form).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        secret_key: appSecret
      },
      timeout: 15000
    }
  );
  return saveTokenBundle(normalizeTokenResponse(response.data));
}

async function exchangeAuthorizationCode(code) {
  const { appId } = assertOauthConfig();
  const codeVerifier = process.env.ZALO_CODE_VERIFIER;
  if (!code) throw new Error('Thiếu authorization code');
  if (!codeVerifier) throw new Error('Thiếu ZALO_CODE_VERIFIER khớp với Code Challenge trên Zalo');
  return requestToken({
    app_id: appId,
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier
  });
}

async function refreshAccessToken(refreshToken) {
  const { appId } = assertOauthConfig();
  const token = refreshToken || loadTokenBundle()?.refresh_token || process.env.ZALO_REFRESH_TOKEN;
  if (!token) throw new Error('Thiếu refresh_token');
  return requestToken({
    app_id: appId,
    grant_type: 'refresh_token',
    refresh_token: token
  });
}

module.exports = {
  exchangeAuthorizationCode,
  refreshAccessToken,
  getAccessToken,
  loadTokenBundle,
  publicTokenStatus
};
