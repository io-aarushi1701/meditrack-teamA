// Thin fetch wrapper around the MediTrack REST API, plus the stored session.
const TOKEN_KEY = 'meditrack.token';
const USER_KEY = 'meditrack.user';

function readStore(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

let token = readStore(TOKEN_KEY);
let user = null;
try { user = JSON.parse(readStore(USER_KEY) || 'null'); } catch { user = null; }

export const session = {
  get token() { return token; },
  get user() { return user; },
  set(newToken, newUser) {
    token = newToken; user = newUser;
    writeStore(TOKEN_KEY, newToken);
    writeStore(USER_KEY, newUser ? JSON.stringify(newUser) : null);
  },
  clear() { this.set(null, null); },
};

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function errorMessage(body, status) {
  const detail = body && body.detail;
  if (Array.isArray(detail)) {
    // pydantic validation errors
    return detail.map(d => {
      const field = (d.loc || []).filter(p => p !== 'body' && p !== 'query').join('.');
      const msg = (d.msg || '').replace(/^Value error, /, '');
      return field ? `${field.replace(/_/g, ' ')}: ${msg}` : msg;
    }).join('; ');
  }
  return detail || `Request failed (${status})`;
}

export async function api(path, { method = 'GET', body, query, raw = false } = {}) {
  let url = '/api' + path;
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') params.set(k, v); });
    const qs = params.toString();
    if (qs) url += '?' + qs;
  }
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Cannot reach the server. Is it running?', 0);
  }
  if (res.status === 401 && token) {
    session.clear();
    window.dispatchEvent(new Event('meditrack:logout'));
  }
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    throw new ApiError(errorMessage(data, res.status), res.status);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

export async function download(path, filename) {
  const res = await api(path, { raw: true });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
