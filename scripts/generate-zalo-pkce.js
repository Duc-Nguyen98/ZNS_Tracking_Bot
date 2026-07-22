const crypto = require('crypto');

function base64Url(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

const codeVerifier = base64Url(crypto.randomBytes(48));
const codeChallenge = base64Url(
  crypto.createHash('sha256').update(codeVerifier).digest()
);
const state = base64Url(crypto.randomBytes(24));

console.log('ZALO_CODE_VERIFIER=' + codeVerifier);
console.log('Code Challenge (dán vào Zalo): ' + codeChallenge);
console.log('ZALO_OAUTH_STATE=' + state);
