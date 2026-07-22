const axios = require('axios');

const USER_FIELD_BASE_URL = 'https://openapi.zalo.me/v3.0/oa/userfield';

function unwrapZaloResponse(response = {}) {
  const payload = response.data;
  if (payload && Number(payload.error || 0) !== 0) {
    const error = new Error(payload.message || `Zalo API error ${payload.error}`);
    error.code = payload.error;
    error.response_data = payload;
    throw error;
  }
  return payload;
}

function requestConfig(accessToken) {
  if (!accessToken) throw new Error('Chưa có OA Access Token');
  return {
    headers: {
      access_token: accessToken,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  };
}

async function listUserFields(accessToken, query = {}) {
  const response = await axios.get(`${USER_FIELD_BASE_URL}/get`, {
    ...requestConfig(accessToken),
    params: query
  });
  return unwrapZaloResponse(response);
}

async function createUserField(accessToken, body) {
  const response = await axios.post(
    `${USER_FIELD_BASE_URL}/create`,
    body,
    requestConfig(accessToken)
  );
  return unwrapZaloResponse(response);
}

async function updateUserField(accessToken, body) {
  const response = await axios.post(
    `${USER_FIELD_BASE_URL}/update`,
    body,
    requestConfig(accessToken)
  );
  return unwrapZaloResponse(response);
}

async function deleteUserField(accessToken, body) {
  const response = await axios.post(
    `${USER_FIELD_BASE_URL}/delete`,
    body,
    requestConfig(accessToken)
  );
  return unwrapZaloResponse(response);
}

module.exports = {
  listUserFields,
  createUserField,
  updateUserField,
  deleteUserField
};
