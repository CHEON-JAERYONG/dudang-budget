// 데이터 저장 + 두 사람 동기화 (비공개 GitHub 저장소의 data.json)
//
// - 모든 기록은 id별로 저장하고 updatedAt(수정시각)을 가짐. 삭제는 deleted 표시(tombstone).
// - 두 기기의 데이터는 "기록 단위 최신값 우선"으로 병합 → 동시에 입력해도 서로 덮어쓰지 않음.
// - 저장은 GitHub Contents API의 sha로 낙관적 잠금. 충돌(409) 시 받아서 병합 후 다시 저장.
// - 오프라인이면 기기에 저장해두고 연결되면 자동 업로드.
import { DEFAULT_REPO } from './config.js?v=2.1.0';
import { uid, loadJSON, saveJSON, b64encUtf8, b64decUtf8 } from './util.js?v=2.1.0';

const LS = { state: 'dudang3.state', sync: 'dudang3.sync', meta: 'dudang3.syncmeta', device: 'dudang3.device' };
export const COLLS = ['tx', 'invest', 'loans', 'recurring', 'goals', 'goalLogs', 'snapshots'];
const TOMBSTONE_TTL = 180 * 864e5;

export const emptyState = () => ({ schema: 3, tx: {}, invest: {}, loans: {}, recurring: {}, goals: {}, goalLogs: {}, snapshots: {}, kv: {} });

export function normalize(s) {
  const e = emptyState();
  if (!s || typeof s !== 'object') return e;
  for (const c of COLLS) if (s[c] && typeof s[c] === 'object' && !Array.isArray(s[c])) e[c] = s[c];
  if (s.kv && typeof s.kv === 'object' && !Array.isArray(s.kv)) e.kv = s.kv;
  return e;
}

// ===== 병합 =====
const stamp = (r) => (r && (r.updatedAt || r.t)) || 0;
function newer(a, b) {
  // b가 a보다 새로우면 true. 시각이 같으면 내용 비교로 결정(두 기기가 같은 결론에 도달하도록)
  const ta = stamp(a), tb = stamp(b);
  if (tb !== ta) return tb > ta;
  return JSON.stringify(sortKeys(b)) > JSON.stringify(sortKeys(a));
}
export function merge(a, b) {
  const out = emptyState();
  for (const c of [...COLLS, 'kv']) {
    const A = a[c] || {}, B = b[c] || {};
    const o = { ...A };
    for (const id in B) if (!o[id] || newer(o[id], B[id])) o[id] = B[id];
    out[c] = o;
  }
  return out;
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}

// 기록 1개 = 1줄. git 변경 기록에서 무엇이 바뀌었는지 보기 쉬움
export function serialize(s) {
  let out = '{\n"schema": 3';
  for (const c of [...COLLS, 'kv']) {
    const obj = s[c] || {};
    const keys = Object.keys(obj).sort();
    out += `,\n"${c}": {` + (keys.length ? '\n' + keys.map((k) => JSON.stringify(k) + ': ' + JSON.stringify(sortKeys(obj[k]))).join(',\n') + '\n' : '') + '}';
  }
  return out + '\n}\n';
}

// ===== 상태 =====
let state = normalize(loadJSON(LS.state));
let device = loadJSON(LS.device) || {};
if (!device.id) { device.id = uid(); saveJSON(LS.device, device); }

const listeners = new Set();
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
function emit(ev) { for (const fn of listeners) { try { fn(ev); } catch (e) { console.error(e); } } }

export const getState = () => state;
export const getDevice = () => device;
export function setDevice(patch) { device = { ...device, ...patch }; saveJSON(LS.device, device); emit({ source: 'device' }); }

export const all = (coll) => Object.values(state[coll] || {}).filter((r) => r && !r.deleted);
export const get = (coll, id) => { const r = state[coll]?.[id]; return r && !r.deleted ? r : null; };
export const exists = (coll, id) => Boolean(state[coll]?.[id]); // 삭제 기록 포함
export const kv = (key, def) => (state.kv[key] && state.kv[key].v !== undefined ? state.kv[key].v : def);

let localVer = 0;
let batchDepth = 0;
let notes = [];

function persistLocal() {
  if (!saveJSON(LS.state, state)) console.warn('localStorage 저장 실패');
}
function afterLocalChange(note) {
  if (note) notes.push(note);
  localVer++;
  meta.dirty = true;
  saveMeta();
  if (batchDepth > 0) return;
  persistLocal();
  emit({ source: 'local' });
  schedulePush();
}

export function batch(fn, note) {
  batchDepth++;
  try { fn(); } finally { batchDepth--; }
  if (batchDepth === 0) afterLocalChange(note);
}

export function upsert(coll, rec, note) {
  const prev = state[coll][rec.id];
  const now = Date.now();
  const r = { ...rec };
  if (!r.id) r.id = uid();
  delete r.deleted;
  r.updatedAt = Math.max(now, stamp(prev) + 1);
  r.createdAt = (prev && !prev.deleted && prev.createdAt) || r.createdAt || now;
  r.by = device.me || r.by || '';
  state[coll][r.id] = r;
  afterLocalChange(note);
  return r;
}

export function remove(coll, id, note) {
  const prev = state[coll][id];
  if (!prev || prev.deleted) return;
  state[coll][id] = { id, deleted: 1, updatedAt: Math.max(Date.now(), stamp(prev) + 1), by: device.me || '' };
  afterLocalChange(note);
}

export function setKV(key, v, note) {
  const prev = state.kv[key];
  state.kv[key] = { v, t: Math.max(Date.now(), stamp(prev) + 1) };
  afterLocalChange(note);
}

// 가져오기/초기화용: 통째로 교체
export function replaceAll(next, note) {
  state = normalize(next);
  afterLocalChange(note);
}

// 오래된 삭제 기록 정리
function compact(s) {
  const cutoff = Date.now() - TOMBSTONE_TTL;
  for (const c of COLLS) for (const id in s[c]) if (s[c][id]?.deleted && stamp(s[c][id]) < cutoff) delete s[c][id];
}

// ===== 동기화 =====
let cfg = loadJSON(LS.sync); // { owner, repo, path, branch, token }
let meta = loadJSON(LS.meta) || { sha: null, etag: null, dirty: false, lastSync: 0, lastError: '' };
function saveMeta() { saveJSON(LS.meta, meta); }

const status = { state: cfg?.token ? 'idle' : 'local', lastSync: meta.lastSync || 0, error: '' };
export const syncStatus = () => ({ ...status, dirty: meta.dirty, configured: Boolean(cfg?.token), repo: cfg ? `${cfg.owner}/${cfg.repo}` : '' });
function setStatus(s, error = '') {
  status.state = s;
  status.error = error;
  if (s === 'synced') { status.lastSync = meta.lastSync = Date.now(); saveMeta(); }
  emit({ source: 'sync' });
}

export const syncConfig = () => (cfg ? { ...cfg } : null);

export function configureSync(c) {
  cfg = { ...DEFAULT_REPO, ...c };
  saveJSON(LS.sync, cfg);
  meta = { sha: null, etag: null, dirty: hasData(state), lastSync: 0, lastError: '' };
  saveMeta();
  setStatus('idle');
}

export function disconnectSync() {
  cfg = null;
  localStorage.removeItem(LS.sync);
  meta = { sha: null, etag: null, dirty: false, lastSync: 0, lastError: '' };
  saveMeta();
  setStatus('local');
}

function hasData(s) {
  return COLLS.some((c) => Object.keys(s[c] || {}).length) || Object.keys(s.kv || {}).length > 0;
}

const API = 'https://api.github.com';
const contentsUrl = () => `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`;

function gh(method, url, { body, headers = {}, accept = 'application/vnd.github+json' } = {}) {
  return fetch(url, {
    method,
    cache: 'no-store',
    headers: { Authorization: 'Bearer ' + cfg.token, Accept: accept, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

class SyncError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }

function authMessage(code) {
  if (code === 401) return '토큰이 올바르지 않거나 만료됐어요. 설정 → 동기화에서 다시 연결해 주세요.';
  return '이 토큰으로는 저장소에 쓸 수 없어요. 토큰의 Contents 권한이 "Read and write"인지, dudang-budget-data 저장소가 선택됐는지 확인해 주세요.';
}

// 연결 테스트 (토큰 입력 직후)
export async function testConnection(c) {
  const t = { ...DEFAULT_REPO, ...c };
  const res = await fetch(`${API}/repos/${t.owner}/${t.repo}`, { cache: 'no-store', headers: { Authorization: 'Bearer ' + t.token, Accept: 'application/vnd.github+json' } });
  if (res.status === 401) throw new Error('토큰이 올바르지 않아요. 복사할 때 앞뒤가 잘리지 않았는지 확인해 주세요.');
  if (res.status === 404 || res.status === 403) throw new Error(`저장소(${t.owner}/${t.repo})에 접근할 수 없어요. 토큰을 만들 때 "Only select repositories"에서 ${t.repo}를 선택했는지 확인해 주세요.`);
  if (!res.ok) throw new Error('GitHub 응답 오류 (' + res.status + ')');
  return true;
}

let pulling = null;
export function pull(opts) {
  if (!pulling) pulling = doPull(opts).finally(() => { pulling = null; });
  return pulling;
}

async function doPull({ force = false } = {}) {
  if (!cfg?.token) return { changed: false };
  const url = contentsUrl() + '?ref=' + encodeURIComponent(cfg.branch || 'main');
  const headers = {};
  if (!force && meta.etag && meta.sha) headers['If-None-Match'] = meta.etag;
  const res = await gh('GET', url, { headers, accept: 'application/vnd.github.object+json' });
  if (res.status === 304) return { changed: false };
  if (res.status === 401 || res.status === 403) throw new SyncError('auth', authMessage(res.status));
  if (res.status === 404) {
    // 저장소는 있는데 파일이 없음 → 첫 업로드 대상
    meta.sha = null; meta.etag = null;
    if (hasData(state)) meta.dirty = true;
    saveMeta();
    return { changed: false, missing: true };
  }
  if (!res.ok) throw new SyncError('http', 'GitHub 응답 오류 (' + res.status + ')');
  const j = await res.json();
  let text;
  if (j.encoding === 'base64' && j.content) text = b64decUtf8(j.content);
  else {
    const raw = await gh('GET', url, { accept: 'application/vnd.github.raw' });
    if (!raw.ok) throw new SyncError('http', 'GitHub 응답 오류 (' + raw.status + ')');
    text = await raw.text();
  }
  const etag = res.headers.get('ETag');
  if (j.sha === meta.sha && !force) { meta.etag = etag; saveMeta(); return { changed: false }; }
  let remote;
  try { remote = normalize(JSON.parse(text || '{}')); } catch { throw new SyncError('parse', '저장소의 data.json을 읽을 수 없어요.'); }
  const changes = applyRemote(remote);
  meta.sha = j.sha;
  meta.etag = etag;
  saveMeta();
  return { changed: changes.length > 0, changes };
}

function applyRemote(remote) {
  const before = state;
  const merged = merge(before, remote);
  const mergedText = serialize(merged);
  const changed = mergedText !== serialize(before);
  meta.dirty = mergedText !== serialize(remote);
  const changes = [];
  if (changed) {
    for (const c of COLLS) {
      for (const id in merged[c]) {
        const n = merged[c][id], o = before[c][id];
        if (n !== o && (!o || stamp(n) !== stamp(o))) changes.push({ coll: c, rec: n, prev: o, kind: n.deleted ? 'del' : o && !o.deleted ? 'edit' : 'add' });
      }
    }
    state = merged;
    persistLocal();
    emit({ source: 'remote', changes });
  }
  return changes.length ? changes : changed ? [{ coll: 'kv' }] : [];
}

function commitMessage() {
  const who = device.me === 'wife' ? '👩' : device.me === 'husband' ? '👨' : '🐻';
  const n = notes.filter(Boolean);
  if (!n.length) return `${who} 가계부 업데이트`;
  const head = n.slice(0, 3).join(' · ');
  return `${who} ${head}${n.length > 3 ? ` 외 ${n.length - 3}건` : ''}`;
}

let pushing = false;
export async function push() {
  if (!cfg?.token || !meta.dirty || pushing) return;
  pushing = true;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const ver = localVer;
      const notesUsed = notes.length;
      compact(state);
      const body = { message: commitMessage(), content: b64encUtf8(serialize(state)), branch: cfg.branch || 'main' };
      if (meta.sha) body.sha = meta.sha;
      const res = await gh('PUT', contentsUrl(), { body });
      if (res.ok) {
        const j = await res.json();
        meta.sha = j.content?.sha || null;
        meta.etag = null;
        notes.splice(0, notesUsed);
        if (localVer === ver) meta.dirty = false;
        saveMeta();
        persistLocal();
        return;
      }
      if (res.status === 409 || res.status === 422) { // 다른 기기가 먼저 저장함 → 받아서 병합 후 재시도
        await doPull({ force: true });
        if (!meta.dirty) return;
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new SyncError('auth', authMessage(res.status));
      throw new SyncError('http', 'GitHub 저장 실패 (' + res.status + ')');
    }
    throw new SyncError('conflict', '동시에 저장이 많이 일어나 잠시 후 다시 시도할게요.');
  } finally {
    pushing = false;
  }
}

let syncing = null;
export function syncNow(opts = {}) {
  if (!cfg?.token) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    setStatus('syncing');
    try {
      const r = await pull(opts);
      if (meta.dirty) await push();
      setStatus('synced');
      return r;
    } catch (e) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (e instanceof SyncError && e.kind === 'auth') setStatus('auth', e.message);
      else setStatus(offline || e instanceof TypeError ? 'offline' : 'error', e.message || String(e));
      throw e;
    } finally { syncing = null; }
  })();
  return syncing;
}

let pushTimer = null;
function schedulePush(delay = 1200) {
  if (!cfg?.token) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { syncNow().catch(() => {}); }, delay);
}

let pollTimer = null;
export function startAutoSync(intervalMs = 15000) {
  if (pollTimer) clearInterval(pollTimer);
  const tick = () => {
    if (!cfg?.token) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    syncNow().catch(() => {});
  };
  pollTimer = setInterval(tick, intervalMs);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
    window.addEventListener('online', tick);
    window.addEventListener('pagehide', () => { if (meta.dirty) syncNow().catch(() => {}); });
  }
}

// 변경 기록 (GitHub 커밋 목록)
export async function history(limit = 30) {
  if (!cfg?.token) return [];
  const res = await gh('GET', `${API}/repos/${cfg.owner}/${cfg.repo}/commits?path=${encodeURIComponent(cfg.path)}&per_page=${limit}`);
  if (!res.ok) throw new Error('기록을 불러오지 못했어요 (' + res.status + ')');
  const list = await res.json();
  return list.map((c) => ({ sha: c.sha, message: c.commit.message, date: c.commit.author?.date }));
}

// 같은 기기의 다른 탭에서 바뀐 경우 즉시 반영
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === LS.state && e.newValue) { try { state = normalize(JSON.parse(e.newValue)); emit({ source: 'storage' }); } catch { /* 무시 */ } }
    if (e.key === LS.meta && e.newValue) { try { meta = JSON.parse(e.newValue); } catch { /* 무시 */ } }
  });
}

// 테스트용
export const _internal = { get meta() { return meta; }, set state(s) { state = s; } };
