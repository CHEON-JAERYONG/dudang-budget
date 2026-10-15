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
  // 9,999.5만 이상은 반올림하면 "10,000만"이 되므로 억으로 표시
  if (a >= 99995000) return s + trimZero((a / 1e8).toFixed(a >= 1e9 ? 1 : 2)) + '억';
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

// ===== 금액 입력 칸 =====
// 정수 13자리(9조)까지 — 그보다 길면 자바스크립트 숫자 정밀도가 깨짐. 소수는 코인 수량용 8자리
const MAX_INT_DIGITS = 13;
const MAX_DEC_DIGITS = 8;
function cleanNumber(s, dec) {
  let t = String(s).replace(dec ? /[^\d.]/g : /\D/g, '');
  const dot = t.indexOf('.');
  if (dot >= 0) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, '').slice(0, MAX_DEC_DIGITS);
  let [i, f] = t.split('.');
  i = i.replace(/^0+(?=\d)/, '').slice(0, MAX_INT_DIGITS);
  if (f !== undefined && !i) i = '0';
  return f !== undefined ? i + '.' + f : i;
}
// 숫자 글자 → "1,234.5" (Number로 바꾸지 않아 큰 수·긴 소수도 그대로)
export function formatNumberText(s, dec = false) {
  const [i, f] = cleanNumber(s, dec).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f !== undefined ? '.' + f : '');
}
const digitsOf = (s) => s.replace(/[^\d.]/g, '');

// 큰 금액 칸은 숫자가 길어지면 글자를 줄여 끝까지 보이게
const fitLong = (el) => { if (el.closest('.amount-wrap')) el.classList.toggle('long', el.value.length > 13); };

// 자동 콤마 + 커서 위치 유지. 쉼표 바로 옆에서 지우면 쉼표 너머 숫자를 지움
export function bindAmountInputs(root) {
  $$('input[data-amount]', root).forEach((el) => {
    const dec = el.dataset.amount === 'dec';
    let before = el.value;
    fitLong(el);
    el.addEventListener('beforeinput', () => { before = el.value; });
    el.addEventListener('input', (e) => {
      let v = el.value;
      let caret = el.selectionStart ?? v.length;
      const del = e.inputType === 'deleteContentBackward' ? -1 : e.inputType === 'deleteContentForward' ? 1 : 0;
      if (del && v.length === before.length - 1 && digitsOf(v) === digitsOf(before)) {
        if (del < 0 && caret > 0) { v = v.slice(0, caret - 1) + v.slice(caret); caret--; }
        if (del > 0) v = v.slice(0, caret) + v.slice(caret + 1);
      }
      const out = formatNumberText(v, dec);
      // 커서 왼쪽에 있던 숫자 개수만큼 새 글자에서 세어 같은 자리에 커서를 둠
      const want = cleanNumber(v.slice(0, caret), dec).length;
      let pos = 0;
      for (let seen = 0; pos < out.length && seen < want; pos++) if (out[pos] !== ',') seen++;
      el.value = out;
      before = out;
      fitLong(el);
      if (document.activeElement === el) el.setSelectionRange(pos, pos);
      el.dispatchEvent(new CustomEvent('amount-change', { bubbles: true }));
    });
  });
}
export const fmtInput = (n) => {
  const x = Number(n);
  if (!x || !Number.isFinite(x)) return '';
  return formatNumberText(Math.abs(x).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: MAX_DEC_DIGITS }), true);
};

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
