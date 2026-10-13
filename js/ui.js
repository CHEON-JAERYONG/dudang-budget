// UI 기본 부품 — 아이콘, 토스트, 시트(모달), 확인창
import { esc } from './util.js?v=2.0.0';

const sv = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const ICON = {
  home: sv('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
  list: sv('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  chart: sv('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  wallet: sv('<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14" r="1.2"/>'),
  gear: sv('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  plus: sv('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.6"'),
  left: sv('<path d="m15 18-6-6 6-6"/>'),
  right: sv('<path d="m9 18 6-6-6-6"/>'),
  search: sv('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  close: sv('<path d="M18 6 6 18M6 6l12 12"/>'),
  refresh: sv('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>'),
  trash: sv('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  copy: sv('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  cloud: sv('<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.3 12.5 3.5 3.5 0 0 0 6 19z"/>'),
  share: sv('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>'),
  clip: sv('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
};

// ===== 토스트 =====
export function toast(msg, opts = {}) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = esc(msg);
  if (opts.action) {
    const b = document.createElement('button');
    b.textContent = opts.action.label;
    b.style.cssText = 'margin-left:12px;color:var(--brand);font-weight:800;pointer-events:auto';
    b.onclick = () => { opts.action.fn(); el.remove(); };
    el.appendChild(b);
    el.style.pointerEvents = 'auto';
  }
  root.appendChild(el);
  while (root.children.length > 3) root.firstChild.remove();
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, opts.ms || (opts.action ? 5000 : 2400));
}

// ===== 시트 =====
let current = null;

export function openSheet({ title, body, foot = '', wide = false, onClose } = {}) {
  const reuse = Boolean(current); // 시트 → 시트 전환 시 뒤로가기 기록은 하나만 유지
  if (current) closeSheet(true);
  const root = document.getElementById('sheet-root');
  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  const el = document.createElement('div');
  el.className = 'sheet' + (wide ? ' wide' : '');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="sheet-h"><h2>${esc(title)}</h2><button class="icon-btn" data-sheet-close aria-label="닫기">${ICON.close}</button></div>
    <div class="sheet-b">${body}</div>${foot ? `<div class="sheet-f">${foot}</div>` : ''}`;
  root.append(bd, el);
  requestAnimationFrame(() => { bd.classList.add('show'); el.classList.add('show'); });
  bd.addEventListener('click', () => closeSheet());
  el.querySelector('[data-sheet-close]').addEventListener('click', () => closeSheet());
  current = { el, bd, onClose, pushed: true };
  if (!reuse || !history.state?.sheet) history.pushState({ sheet: 1 }, '');
  document.body.style.overflow = 'hidden';
  return el;
}

export function closeSheet(fromPop = false) {
  if (!current) return;
  const { el, bd, onClose, pushed } = current;
  current = null;
  el.classList.remove('show');
  bd.classList.remove('show');
  setTimeout(() => { el.remove(); bd.remove(); }, 260);
  document.body.style.overflow = '';
  if (pushed && !fromPop && history.state?.sheet) history.back();
  onClose?.();
}
export const sheetOpen = () => Boolean(current);

window.addEventListener('popstate', () => { if (current) closeSheet(true); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) closeSheet(); });

// ===== 확인창 =====
export function confirmSheet({ title, message, ok = '확인', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const el = openSheet({
      title,
      body: `<p style="margin:4px 0 6px;color:var(--ink-2);line-height:1.6">${message}</p>`,
      foot: `<button class="btn" data-no>취소</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(ok)}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    el.querySelector('[data-no]').onclick = () => closeSheet();
    el.querySelector('[data-yes]').onclick = () => { done = true; resolve(true); closeSheet(); };
  });
}
