// 공용 유틸 — 포맷, 날짜, DOM 헬퍼
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== 숫자 =====
export const num = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
export const won = (n) => num(n) + '원';
// 좁은 칸용: 1억 이상은 1.23억원
export const fitWon = (n) => (Math.abs(n) >= 1e8 ? compactWon(n) + '원' : won(n));
export const signedWon = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + num(Math.abs(n)) + '원';

// 1,234만 / 1.2억 형태
export function compactWon(n) {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e8) return s + trimZero((a / 1e8).toFixed(a >= 1e9 ? 1 : 2)) + '억';
  if (a >= 1e4) return s + num(Math.round(a / 1e4)) + '만';
  return s + num(a);
}
const trimZero = (x) => x.replace(/\.?0+$/, '');

export function parseAmount(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[^\d.\-]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function fmtDec(n, digits = 2) {
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export const pct = (n, d = 1) => (Number.isFinite(n) ? (n > 0 ? '+' : '') + n.toFixed(d) + '%' : '-');

// 금액 입력 칸 자동 콤마
export function bindAmountInputs(root) {
  $$('input[data-amount]', root).forEach((el) => {
    el.addEventListener('input', () => {
      const allowDec = el.dataset.amount === 'dec';
      let raw = el.value.replace(allowDec ? /[^\d.]/g : /[^\d]/g, '');
      if (allowDec) {
        const [i, ...rest] = raw.split('.');
        const intPart = i ? Number(i).toLocaleString('ko-KR') : (rest.length ? '0' : '');
        el.value = rest.length ? intPart + '.' + rest.join('').slice(0, 6) : intPart;
      } else {
        el.value = raw ? Number(raw).toLocaleString('ko-KR') : '';
      }
      el.dispatchEvent(new CustomEvent('amount-change', { bubbles: true }));
    });
  });
}
export const fmtInput = (n) => (n || n === 0 ? (Number(n) ? Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 6 }) : '') : '');

// ===== 날짜 (로컬 시간 기준) =====
const pad = (n) => String(n).padStart(2, '0');
export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const ym = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const today = () => ymd(new Date());
export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addMonths(ymStr, delta) {
  const [y, m] = ymStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return ym(d);
}
export function daysInMonth(ymStr) {
  const [y, m] = ymStr.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export function monthLabel(ymStr, withYear = true) {
  const [y, m] = ymStr.split('-').map(Number);
  return withYear ? `${y}년 ${m}월` : `${m}월`;
}
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const weekday = (s) => WD[parseYmd(s).getDay()];
export function dayLabel(s) {
  const d = parseYmd(s);
  const t = today();
  const yest = ymd(new Date(Date.now() - 864e5));
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
  if (s === t) return '오늘 · ' + base;
  if (s === yest) return '어제 · ' + base;
  return base;
}
export function relTime(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return '방금';
  if (s < 60) return s + '초 전';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  return Math.floor(s / 86400) + '일 전';
}
export function clock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ===== 인코딩 =====
export function b64encUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64decUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
export const b64url = (s) => b64encUtf8(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s) => b64decUtf8(s.replace(/-/g, '+').replace(/_/g, '/'));

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ===== 저장 =====
export function loadJSON(key, def = null) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : def;
  } catch { return def; }
}
export function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
