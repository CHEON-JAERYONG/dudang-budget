// 우리 가계부 2.0 — 앱 시작, 화면 전환, 동기화·시세 루프
import {
  subscribe, all, get, exists, upsert, batch, kv, setKV, syncNow, startAutoSync, syncStatus, configureSync, testConnection,
  getDevice, setDevice,
} from './store.js?v=2.1.3';
import {
  ui, names, person, me, assetType, recTxId, ruleDate, netWorth, refreshSec, destroyCharts, isDesktop,
} from './core.js?v=2.1.3';
import { homeView, listView, listBody, statsView, assetsView, settingsView, investInner, homeAssetsInner, syncCardInner } from './views.js?v=2.1.3';
import {
  openTxForm, openInvestForm, openLoanForm, openGoalForm, openGoalDeposit, openRecurringForm, openBudgetSheet, openCatsSheet,
  openSyncSheet, openPairSheet, openHistorySheet, confirmDisconnect, exportCsv, exportJson, importFile, resetAll, openPinSetup,
} from './forms.js?v=2.1.3';
import { refreshQuotes, refreshFx, getQuote } from './market.js?v=2.1.3';
import { $, $$, esc, num, ym, today, addMonths, relTime, loadJSON, saveJSON, sha256, unb64url, debounce } from './util.js?v=2.1.3';
import { ICON, toast, sheetOpen, closeSheet } from './ui.js?v=2.1.3';

const ROUTES = { home: homeView, list: listView, stats: statsView, assets: assetsView, settings: settingsView };
const NAV = [
  { r: 'home', label: '홈', icon: ICON.home },
  { r: 'list', label: '내역', icon: ICON.list },
  { r: 'stats', label: '통계', icon: ICON.chart },
  { r: 'assets', label: '자산', icon: ICON.wallet },
  { r: 'settings', label: '설정', icon: ICON.gear },
];

// ===== 셸 =====
function syncChip() {
  const st = syncStatus();
  const map = {
    local: ['', '📱 이 기기만'],
    idle: ['ok', '동기화됨'],
    synced: ['ok', '동기화됨'],
    syncing: ['busy', '동기화 중'],
    offline: ['err', '오프라인'],
    error: ['err', '동기화 오류'],
    auth: ['err', '연결 확인 필요'],
  };
  const [cls, label] = map[st.state] || map.local;
  const title = st.configured ? `${st.repo}${st.lastSync ? ' · 마지막 동기화 ' + relTime(st.lastSync) : ''}` : '눌러서 둘이 함께 쓰기 연결';
  return `<button class="sync-chip ${cls}" data-act="sync-chip" title="${esc(title)}"><span class="dot"></span>${label}${st.dirty && st.configured && st.state !== 'syncing' ? ' ·  올리는 중' : ''}</button>`;
}

function renderShell() {
  $('#sidebar').innerHTML = `<div class="brand"><span class="bear">🐻</span> 우리 가계부 <small>2.0</small></div>
    <button class="btn btn-primary side-add" data-act="add">${ICON.plus} 입력하기</button>
    ${NAV.map((n) => `<a href="#/${n.r}" class="side-link ${ui.route === n.r ? 'active' : ''}" data-go="${n.r}">${n.icon}${n.label}</a>`).join('')}
    <div class="side-foot" id="side-foot">${sideFoot()}</div>`;
  $('#topbar').innerHTML = `<div class="brand"><span class="bear">🐻</span> 우리 가계부</div><span class="spacer"></span><span id="sync-chip-wrap">${syncChip()}</span>
    <button class="icon-btn mobile-only" data-go="settings" aria-label="설정">${ICON.gear}</button>`;
  $('#tabbar').innerHTML = NAV.filter((n) => n.r !== 'settings').map((n, i) => (i === 2 ? `<div class="tab-add"><button class="fab" data-act="add" aria-label="새 내역 입력">${ICON.plus}</button></div>` : '')
    + `<button class="tab ${ui.route === n.r ? 'active' : ''}" data-go="${n.r}">${n.icon}<span>${n.label}</span></button>`).join('');
}
function sideFoot() {
  const p = person(me());
  return `${me() === 'both' ? '' : `이 기기: ${p.emoji} ${esc(p.name)}<br>`}<span class="tiny">단축키 <b>N</b> 새 입력 · <b>/</b> 검색</span>`;
}
function updateNavActive() {
  $$('[data-go]').forEach((el) => el.classList.toggle('active', el.dataset.go === ui.route && (el.classList.contains('tab') || el.classList.contains('side-link'))));
}
function updateSyncIndicators() {
  const w = $('#sync-chip-wrap');
  if (w) w.innerHTML = syncChip();
  if (ui.route === 'settings') { const c = $('#sync-card'); if (c) c.innerHTML = syncCardInner(); }
}

// ===== 화면 =====
let lastRoute = null;
function renderView() {
  destroyCharts();
  const view = $('#view');
  const ae = document.activeElement;
  const keep = ae && view.contains(ae) && ae.id ? { id: ae.id, value: ae.value, s: ae.selectionStart, e: ae.selectionEnd } : null;
  const routeChanged = lastRoute !== ui.route;
  const v = ROUTES[ui.route]();
  view.innerHTML = `<div class="${routeChanged ? 'fade-in' : ''}">${v.html}</div>`;
  v.mount?.();
  if (routeChanged) { window.scrollTo(0, 0); lastRoute = ui.route; }
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      if (typeof keep.value === 'string' && el.value !== keep.value) el.value = keep.value;
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(keep.s, keep.e); } catch { /* date/select 등 */ }
    }
  }
}
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderView(); });
}

function navigate(r) {
  if (!ROUTES[r]) r = 'home';
  if (location.hash !== '#/' + r) location.hash = '#/' + r;
  else route();
}
function route() {
  const r = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'home';
  ui.route = ROUTES[r] ? r : 'home';
  if (sheetOpen()) closeSheet();
  updateNavActive();
  renderView();
  if ((ui.route === 'assets' || ui.route === 'home') && Date.now() - lastQuoteRun > Math.max(30, refreshSec()) * 1000) refreshAllQuotes(true);
}

// ===== 동작 =====
const ACTIONS = {
  month: (a) => { ui.month = addMonths(ui.month, Number(a.dataset.d)); renderView(); },
  year: (a) => { ui.statsYear += Number(a.dataset.d); renderView(); },
  add: (a) => openTxForm({ preset: a.dataset.preset, date: a.dataset.date, type: a.dataset.type }),
  tx: (a) => openTxForm({ id: a.dataset.id }),
  'list-mode': (a) => { ui.list.mode = a.dataset.v; renderView(); },
  lf: (a) => { ui.list[a.dataset.k] = a.dataset.v; renderView(); },
  'cal-day': (a) => { ui.calSel = a.dataset.d; $('#list-body').innerHTML = listBody(); },
  'stats-mode': (a) => { ui.statsMode = a.dataset.v; if (a.dataset.v === 'year') ui.statsYear = Number(ui.month.slice(0, 4)); renderView(); },
  atab: (a) => { ui.assetsTab = a.dataset.v; renderView(); },
  'atab-go': (a) => { ui.assetsTab = a.dataset.v; navigate('assets'); },
  'expand-cat': (a) => { ui.expandCat = ui.expandCat === a.dataset.k ? null : a.dataset.k; renderView(); },
  'refresh-quotes': () => refreshAllQuotes(false),
  'invest-new': (a) => openInvestForm({ kind: a.dataset.kind }),
  invest: (a) => openInvestForm({ id: a.dataset.id }),
  'loan-new': () => openLoanForm(),
  loan: (a) => openLoanForm({ id: a.dataset.id }),
  'goal-new': () => openGoalForm(),
  goal: (a) => openGoalForm({ id: a.dataset.id }),
  'goal-deposit': (a) => openGoalDeposit({ id: a.dataset.id }),
  budget: () => openBudgetSheet(),
  recurring: () => navigate('settings'),
  'rec-edit': (a) => openRecurringForm({ id: a.dataset.id }),
  cats: () => openCatsSheet(),
  sync: () => openSyncSheet({ onDone: afterConnected }),
  pair: () => openPairSheet(),
  'sync-now': () => syncNow({ force: true }).then(() => toast('☁️ 동기화 완료')).catch((e) => toast('⚠️ ' + e.message)),
  'sync-chip': () => {
    const st = syncStatus();
    if (!st.configured) openSyncSheet({ onDone: afterConnected });
    else if (st.state === 'auth' || st.state === 'error') navigate('settings');
    else ACTIONS['sync-now']();
  },
  history: () => openHistorySheet(),
  disconnect: () => confirmDisconnect(),
  'export-csv': () => exportCsv(),
  'export-json': () => exportJson(),
  import: () => importFile(),
  reset: () => resetAll(),
  'set-me': (a) => { setDevice({ me: a.dataset.v }); toast(`이 기기는 ${person(a.dataset.v).emoji} ${person(a.dataset.v).name} 기기예요`); },
};

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go && !e.target.closest('.sheet')) {
    e.preventDefault();
    navigate(go.dataset.go);
    return;
  }
  const a = e.target.closest('[data-act]');
  if (!a || a.closest('.sheet')) return;
  const fn = ACTIONS[a.dataset.act];
  if (fn) { e.preventDefault(); fn(a, e); }
});

// 화면 안 입력칸
const view = () => $('#view');
document.addEventListener('input', (e) => {
  if (e.target.id === 'list-q') {
    ui.list.q = e.target.value;
    debouncedListBody();
  }
});
const debouncedListBody = debounce(() => { const b = $('#list-body'); if (b) b.innerHTML = listBody(); }, 160);

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!view()?.contains(t)) return;
  switch (t.id) {
    case 'list-cat': ui.list.cat = t.value; $('#list-body').innerHTML = listBody(); break;
    case 'set-name-h':
    case 'set-name-w': {
      const n = { ...(kv('names', {}) || {}) };
      n[t.id === 'set-name-h' ? 'husband' : 'wife'] = t.value.trim();
      setKV('names', n, '이름 변경');
      toast('✓ 저장했어요');
      break;
    }
    case 'set-wedding': setKV('wedding', t.value, '결혼기념일 설정'); toast('💕 저장했어요'); break;
    case 'set-refresh': saveJSON('dudang3.refresh', Number(t.value)); scheduleQuotes(); toast('✓ 시세 갱신 주기를 바꿨어요'); break;
    case 'set-theme': applyTheme(t.value); break;
    case 'set-pin':
      if (t.checked) openPinSetup((on) => { t.checked = on; });
      else { localStorage.removeItem('dudang3.pin'); toast('🔓 잠금을 해제했어요'); }
      break;
    default:
  }
});

function applyTheme(v) {
  if (v === 'light' || v === 'dark') { document.documentElement.dataset.theme = v; saveJSON('dudang3.theme', v); }
  else { delete document.documentElement.dataset.theme; localStorage.removeItem('dudang3.theme'); }
  renderView();
}

document.addEventListener('keydown', (e) => {
  if (sheetOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || $('#screen-root').children.length) return;
  if (e.key === 'n' || e.key === 'N' || e.key === 'ㅜ') { e.preventDefault(); openTxForm(); }
  if (e.key === '/') { e.preventDefault(); navigate('list'); setTimeout(() => $('#list-q')?.focus(), 50); }
});

// ===== 데이터 변경 반영 =====
subscribe((ev) => {
  if (ev.source === 'sync') { updateSyncIndicators(); return; }
  if (ev.source === 'device') { $('#side-foot') && ($('#side-foot').innerHTML = sideFoot()); scheduleRender(); return; }
  if (ev.source === 'remote') { notifyRemote(ev.changes || []); runRecurring(); }
  updateSyncIndicators();
  scheduleRender();
});

function notifyRemote(changes) {
  const mine = me();
  const theirs = changes.filter((c) => c.rec && c.rec.by && c.rec.by !== mine);
  if (!theirs.length) return;
  const who = person(theirs[0].rec.by);
  const tx = theirs.filter((c) => c.coll === 'tx' && c.kind === 'add' && !c.rec.recurringId);
  if (tx.length === 1) {
    const t = tx[0].rec;
    toast(`${who.emoji} ${who.name}: ${t.memo || '내역'} ${num(t.amount)}원 ${t.type === 'income' ? '수입' : '지출'} 추가`);
  } else {
    toast(`${who.emoji} ${who.name}이(가) ${theirs.length}건을 업데이트했어요`);
  }
}

// ===== 고정지출 자동 입력 =====
let recurringReady = false;
function runRecurring() {
  if (!recurringReady) return;
  const m = ym(), td = today();
  const toAdd = [];
  for (const r of all('recurring')) {
    if (r.active === false) continue;
    for (const mm of [addMonths(m, -1), m]) {
      if (r.start && r.start > mm) continue;
      const date = ruleDate(r, mm);
      if (date > td) continue;
      const id = recTxId(r.id, mm);
      if (exists('tx', id)) continue;
      toAdd.push({ id, type: r.type === 'income' ? 'income' : 'expense', amount: r.amount, memo: r.memo, cat: r.cat, person: r.person, pay: r.pay || '', date, recurringId: r.id });
    }
  }
  if (!toAdd.length) return;
  batch(() => toAdd.forEach((t) => upsert('tx', t)), `고정 자동입력 ${toAdd.map((t) => t.memo).filter(Boolean).slice(0, 2).join(', ')} ${toAdd.length}건`);
  toast(`🔁 고정 ${toAdd.length}건을 자동으로 입력했어요`);
}

// ===== 시세 =====
let quoteTimer = null;
let lastQuoteRun = 0;
const marketSymbols = () => all('invest').filter((h) => assetType(h.type).market && h.symbol && !h.manualPrice).map((h) => h.symbol);

function zoneNow(tz) { return new Date(new Date().toLocaleString('en-US', { timeZone: tz })); }
function isOpenNow(sym) {
  if (sym.startsWith('CR:')) return true;
  if (sym.startsWith('KR:')) {
    const k = zoneNow('Asia/Seoul'), d = k.getDay(), t = k.getHours() * 60 + k.getMinutes();
    return d >= 1 && d <= 5 && t >= 8 * 60 + 55 && t <= 15 * 60 + 40;
  }
  const q = getQuote(sym);
  if (q && q.market === 'OPEN') return true;
  const e = zoneNow('America/New_York'), d = e.getDay(), t = e.getHours() * 60 + e.getMinutes();
  return d >= 1 && d <= 5 && t >= 9 * 60 + 25 && t <= 16 * 60 + 5;
}

function updateQuoteParts() {
  if (ui.route === 'assets' && ui.assetsTab === 'invest') { const el = $('#invest-inner'); if (el && !sheetOpen()) el.innerHTML = investInner(); else if (el) scheduleRender(); }
  if (ui.route === 'home') { const el = $('#home-assets'); if (el) el.innerHTML = homeAssetsInner(); }
}

async function refreshAllQuotes(silent = true) {
  const syms = marketSymbols();
  if (!syms.length) { refreshFx(); return; }
  ui.quoteBusy = true;
  updateQuoteParts();
  try {
    const r = await refreshQuotes(syms, { fast: !silent });
    ui.quoteErr = r.ok === 0 && r.failed ? '시세 연결 실패' : '';
    if (!silent) toast(r.ok ? `✨ ${r.ok}개 종목 시세를 새로 받았어요` : '⚠️ 시세를 받지 못했어요. 잠시 후 다시 시도해 주세요');
  } catch (e) {
    ui.quoteErr = e.message;
  } finally {
    ui.quoteBusy = false;
    lastQuoteRun = Date.now();
    updateQuoteParts();
    updateSnapshot();
  }
}

function scheduleQuotes() {
  clearInterval(quoteTimer);
  const sec = refreshSec();
  if (!sec) return;
  quoteTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (ui.route !== 'home' && ui.route !== 'assets') return;
    const syms = marketSymbols();
    if (!syms.length) return;
    const open = syms.some(isOpenNow);
    if (!open && Date.now() - lastQuoteRun < 10 * 60e3) return; // 장 마감 중엔 10분에 한 번
    refreshAllQuotes(true);
  }, sec * 1000);
}

// 월별 순자산 기록 (하루 한 번)
function updateSnapshot() {
  if (!recurringReady) return;
  if (!all('invest').length && !all('loans').length) return;
  const m = ym();
  const nw = netWorth();
  const s = get('snapshots', m);
  if (s && s.day === today()) return;
  upsert('snapshots', { id: m, assets: Math.round(nw.assets), debts: Math.round(nw.debts), net: Math.round(nw.net), day: today() }, `순자산 기록 ${m}`);
}

// ===== 잠금 =====
let hiddenAt = 0;
function showLock() {
  const pin = loadJSON('dudang3.pin');
  if (!pin || $('#lock-screen')) return;
  let cur = '';
  let forgot = 0;
  const root = $('#screen-root');
  const wrap = document.createElement('div');
  wrap.className = 'screen';
  wrap.id = 'lock-screen';
  wrap.innerHTML = `<div class="screen-box"><div class="logo">🐻</div><h1>우리 가계부</h1><p>비밀번호 4자리를 입력하세요</p>
    <div class="pin-dots" id="lk-dots"><i></i><i></i><i></i><i></i></div>
    <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button data-k="${d}">${d}</button>`).join('')}<span></span><button data-k="0">0</button><button class="ghost" data-k="del">지우기</button></div>
    <button class="btn btn-sm" id="lk-forgot" style="margin-top:22px;background:transparent;color:var(--ink-3)">비밀번호를 잊었어요</button></div>`;
  root.appendChild(wrap);
  const dots = () => $$('#lk-dots i', wrap).forEach((d, i) => d.classList.toggle('on', i < cur.length));
  wrap.querySelector('.keypad').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    if (b.dataset.k === 'del') cur = cur.slice(0, -1); else if (cur.length < 4) cur += b.dataset.k;
    dots();
    if (cur.length < 4) return;
    const h = await sha256(getDevice().id + ':' + cur);
    if (h === pin.h) { wrap.remove(); return; }
    cur = '';
    $('#lk-dots', wrap).classList.add('shake');
    setTimeout(() => { $('#lk-dots', wrap).classList.remove('shake'); dots(); }, 400);
  });
  document.addEventListener('keydown', function onKey(e) {
    if (!document.body.contains(wrap)) { document.removeEventListener('keydown', onKey); return; }
    const k = /^\d$/.test(e.key) ? e.key : e.key === 'Backspace' ? 'del' : null;
    if (k) wrap.querySelector(`button[data-k="${k}"]`)?.click();
  });
  $('#lk-forgot', wrap).addEventListener('click', (e) => {
    forgot++;
    if (forgot === 1) {
      e.target.textContent = syncStatus().configured
        ? '한 번 더 누르면 이 기기의 잠금과 저장된 데이터를 지워요 (저장소 데이터는 안전 · 배우자 QR로 다시 연결)'
        : '한 번 더 누르면 이 기기의 잠금과 모든 데이터를 지워요 (동기화 안 됨 · 복구 불가)';
      e.target.style.whiteSpace = 'normal';
      e.target.style.height = 'auto';
      e.target.style.padding = '10px';
      return;
    }
    Object.keys(localStorage).filter((k) => k.startsWith('dudang3.')).forEach((k) => localStorage.removeItem(k));
    location.reload();
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else {
    if (hiddenAt && Date.now() - hiddenAt > 3 * 60e3) showLock();
    if ((ui.route === 'assets' || ui.route === 'home') && Date.now() - lastQuoteRun > Math.max(30, refreshSec()) * 1000) refreshAllQuotes(true);
    if (ui.month !== ym() && hiddenAt && new Date(hiddenAt).getMonth() !== new Date().getMonth()) { ui.month = ym(); scheduleRender(); }
    runRecurring();
  }
});

// ===== 처음 시작 / 배우자 연결 =====
let pendingPair = null;
function readPairHash() {
  if (!location.hash.startsWith('#pair=')) return;
  try {
    const p = JSON.parse(unb64url(location.hash.slice(6)));
    if (p.t) pendingPair = { owner: p.o, repo: p.r, token: p.t, hint: p.me };
  } catch (e) { console.warn('pair link', e); }
  history.replaceState(null, '', location.pathname + location.search + '#/home');
}

async function connectPending() {
  const c = pendingPair;
  pendingPair = null;
  try {
    await testConnection(c);
    configureSync({ owner: c.owner, repo: c.repo, token: c.token });
    await syncNow({ force: true });
    toast('💕 같은 가계부에 연결됐어요!');
    afterSyncReady();
  } catch (e) {
    toast('⚠️ 연결 실패: ' + e.message, { ms: 6000 });
  }
}

function afterConnected() {
  afterSyncReady();
  setTimeout(() => openPairSheet(), 400);
}

function showWho() {
  return new Promise((resolve) => {
    const hint = pendingPair?.hint;
    const root = $('#screen-root');
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    wrap.innerHTML = `<div class="screen-box fade-in"><div class="logo">🐻</div><h1>우리 가계부</h1>
      <p>${pendingPair ? '배우자가 보낸 연결 링크로 들어왔어요 💌<br>' : '신혼부부 둘이 함께 쓰는 가계부예요.<br>'}이 기기는 누가 쓰나요?</p>
      <div class="who-pick"><button data-me="husband" ${hint === 'husband' ? 'style="border-color:var(--brand)"' : ''}><span class="e">👨</span>남편</button><button data-me="wife" ${hint === 'wife' ? 'style="border-color:var(--brand)"' : ''}><span class="e">👩</span>아내</button></div>
      <p class="tiny muted">나중에 설정에서 바꿀 수 있어요</p></div>`;
    root.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-me]');
      if (!b) return;
      setDevice({ me: b.dataset.me });
      wrap.remove();
      resolve();
    });
  });
}

function showSyncIntro() {
  return new Promise((resolve) => {
    const root = $('#screen-root');
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    wrap.innerHTML = `<div class="screen-box fade-in"><div class="logo">☁️</div><h1>둘이 함께 쓰기</h1>
      <p>동기화를 연결하면 남편 폰, 아내 폰, PC 어디서 입력해도<br><b>실시간으로 같은 가계부</b>가 돼요. 무료예요.</p>
      <button class="btn btn-primary btn-block" data-c="sync" style="height:52px;font-size:16px">☁️ 지금 연결하기 (3분)</button>
      <div style="height:10px"></div>
      <button class="btn btn-block" data-c="later">이 기기에서 먼저 써볼게요</button>
      <p class="tiny muted" style="margin-top:16px">배우자가 이미 연결했다면, 배우자 폰의 설정 → “배우자 폰 연결하기” QR을 찍으면 돼요.</p></div>`;
    root.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-c]');
      if (!b) return;
      setDevice({ introDone: true });
      wrap.remove();
      if (b.dataset.c === 'sync') openSyncSheet({ onDone: afterConnected });
      resolve();
    });
  });
}

let syncReadyOnce = false;
function afterSyncReady() {
  if (syncReadyOnce) return;
  syncReadyOnce = true;
  recurringReady = true;
  runRecurring();
  updateSnapshot();
}

// ===== 시작 =====
async function boot() {
  readPairHash();
  renderShell();
  route();
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#pair=')) { readPairHash(); if (getDevice().me) connectPending(); return; } route(); });
  window.matchMedia('(min-width: 960px)').addEventListener('change', () => renderView());

  if (loadJSON('dudang3.pin')) showLock();

  const dev = getDevice();
  if (!dev.me) await showWho();
  renderShell();
  renderView();

  const st = syncStatus();
  if (pendingPair) await connectPending();
  else if (!st.configured && !getDevice().introDone) await showSyncIntro();

  startAutoSync(15000);
  if (syncStatus().configured) {
    syncNow().then(afterSyncReady).catch(() => { /* 오프라인이면 다음 동기화 후 */ });
    const iv = setInterval(() => { if (syncStatus().state === 'synced') { clearInterval(iv); afterSyncReady(); } }, 5000);
  } else {
    afterSyncReady();
  }

  refreshAllQuotes(true);
  scheduleQuotes();

  const add = new URLSearchParams(location.search).get('add');
  if (add) { history.replaceState(null, '', location.pathname + location.hash); openTxForm({ type: add === 'income' ? 'income' : 'expense' }); }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
}

// 다른 기기 설정이 바뀐 경우 대비 (로컬모드 → 자동 화면 갱신)
setInterval(() => { if (!sheetOpen() && ui.route === 'home' && document.visibilityState === 'visible') updateSyncIndicators(); }, 30000);

boot();
