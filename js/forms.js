// 입력 시트 — 거래, 자산, 대출, 목표, 고정지출, 예산, 카테고리, 동기화, 가져오기
import {
  all, get, kv, upsert, remove, setKV, batch, replaceAll, getState, merge, normalize, emptyState, serialize,
  configureSync, disconnectSync, testConnection, syncNow, syncConfig, history, getDevice,
} from './store.js?v=2.0.0';
import { PERSONS, PAYS, ASSET_TYPES, LOAN_TYPES, EXPENSE_CATS, INCOME_CATS, TOKEN_URL, DEFAULT_REPO } from './config.js?v=2.0.0';
import { ui, names, person, me, catList, cat, assetType, recTxId, goalCurrent, budgetTotal, budgetCat } from './core.js?v=2.0.0';
import { searchSymbols, refreshQuotes, getQuote, krwPer, normalizeSymbol, symbolLabel } from './market.js?v=2.0.0';
import {
  $, $$, esc, uid, num, won, parseAmount, fmtInput, bindAmountInputs, today, ym, ymd, parseYmd, debounce, b64url,
  download, loadJSON, saveJSON, sha256, relTime, fmtDec,
} from './util.js?v=2.0.0';
import { openSheet, closeSheet, toast, confirmSheet, ICON } from './ui.js?v=2.0.0';

const typeKey = (t) => (t === 'income' ? 'income' : 'expense');
const catGrid = (type, sel, id) => `<div class="cat-grid ${type === 'income' ? 'inc' : ''}" id="${id}">${catList(type).map((c) => `<button type="button" class="cat-btn ${c.key === sel ? 'on' : ''}" data-v="${esc(c.key)}"><span class="e">${c.emoji}</span><span>${esc(c.name)}</span></button>`).join('')}</div>`;
const personPicks = (sel, id) => `<div class="pick-row persons" id="${id}">${PERSONS.map((p) => `<button type="button" class="pick ${p.key === sel ? 'on' : ''}" data-v="${p.key}">${p.emoji} ${esc(names()[p.key])}</button>`).join('')}</div>`;
const payPicks = (sel, id) => `<div class="pick-row" id="${id}">${PAYS.map((p) => `<button type="button" class="pick ${p.key === sel ? 'on' : ''}" data-v="${p.key}">${p.emoji} ${p.name}</button>`).join('')}</div>`;

// 버튼 그룹 단일 선택
function bindPick(root, sel, onPick) {
  const wrap = $(sel, root);
  if (!wrap) return;
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    $$('button[data-v]', wrap).forEach((x) => x.classList.toggle('on', x === b));
    onPick(b.dataset.v);
  });
}
function setPick(root, sel, v) { $$(sel + ' button[data-v]', root).forEach((x) => x.classList.toggle('on', x.dataset.v === v)); }

// ===== 카드 문자 해석 =====
export function parseSms(text) {
  const t = String(text || '').replace(/\r/g, '').replace(/\[Web발신\]/g, '').trim();
  if (!t) return null;
  const out = {};
  const amt = t.match(/([\d,]{1,15})\s*원/);
  if (amt) out.amount = parseAmount(amt[1]);
  const dt = t.match(/(\d{1,2})[\/.\-](\d{1,2})\s*(\d{1,2}):(\d{2})/) || t.match(/(\d{1,2})[\/.\-](\d{1,2})/);
  if (dt) {
    const now = new Date();
    const mo = Number(dt[1]), d = Number(dt[2]);
    let y = now.getFullYear();
    if (mo > now.getMonth() + 1) y--;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.date = ymd(new Date(y, mo - 1, d));
  }
  out.cancel = /취소/.test(t);
  out.pay = /페이|pay/i.test(t) && !/카드/.test(t) ? 'pay' : /체크|출금|이체/.test(t) && !/카드/.test(t) ? 'bank' : 'card';
  // 가맹점: 시각 뒤의 글자, 없으면 줄 단위로 추정
  let merchant = '';
  const after = t.match(/\d{1,2}:\d{2}\s*([^\n]+)/);
  if (after) merchant = after[1].replace(/(누적|잔액|사용가능)[\s\S]*$/, '').trim();
  if (!merchant) {
    const lines = t.split('\n').map((s) => s.trim()).filter(Boolean)
      .filter((s) => !/(승인|원|누적|잔액|카드|\d{1,2}[\/.\-]\d{1,2}|\*)/.test(s));
    merchant = lines[lines.length - 1] || '';
  }
  out.memo = merchant.replace(/\s{2,}/g, ' ').slice(0, 40);
  return out.amount ? out : null;
}

// ===== 거래 입력 =====
export function openTxForm({ id, type, preset, date, copyFrom } = {}) {
  const ex = id ? get('tx', id) : null;
  const src = ex || copyFrom;
  const f = src
    ? { ...src, date: copyFrom ? today() : src.date }
    : { type: type || 'expense', amount: 0, cat: '', memo: '', person: me(), pay: 'card', date: date || today() };
  if (!src && f.type === 'income') f.pay = '';
  let catTouched = Boolean(src);
  if (preset && preset.startsWith('card')) {
    const p = preset.split('-')[1];
    Object.assign(f, { type: 'expense', cat: 'card', pay: 'bank' });
    if (p && p !== 'both') { f.person = p; f.memo = `${names()[p]} 카드값`; }
    catTouched = true;
  }
  if (!f.cat) f.cat = f.type === 'income' ? 'salary' : 'food';

  // 메모 자동완성 색인
  const idx = new Map();
  for (const t of all('tx')) {
    const memo = (t.memo || '').trim();
    if (!memo) continue;
    const k = typeKey(t.type) + '|' + memo;
    const e = idx.get(k) || { memo, type: typeKey(t.type), n: 0, cat: t.cat, pay: t.pay, amount: t.amount, last: '' };
    e.n++;
    if ((t.date || '') >= e.last) { e.last = t.date || ''; e.cat = t.cat; e.pay = t.pay; e.amount = t.amount; }
    idx.set(k, e);
  }

  const n = names();
  const isNew = !ex;
  const body = `
    <div class="seg full big" id="tf-type"><button type="button" class="exp ${f.type !== 'income' ? 'on' : ''}" data-v="expense">지출</button><button type="button" class="inc ${f.type === 'income' ? 'on' : ''}" data-v="income">수입</button></div>
    <div style="height:14px"></div>
    ${isNew ? `<div class="quick-bills ${f.type === 'income' ? 'hidden' : ''}" id="tf-bills"><button type="button" data-p="husband">💳 ${esc(n.husband)} 카드값</button><button type="button" data-p="wife">💳 ${esc(n.wife)} 카드값</button></div>` : ''}
    <div class="field">
      <div class="lab"><span>금액</span>${isNew ? '<button type="button" class="chip soft" id="tf-sms" style="height:28px">📋 카드 문자로 입력</button>' : ''}</div>
      <div id="tf-sms-box" class="hidden"><textarea class="input" id="tf-sms-text" placeholder="카드 승인 문자를 복사해서 붙여넣으세요&#10;예) 신한카드(1234)승인 김*룡 12,000원 일시불 10/13 12:31 스타벅스"></textarea><div style="display:flex;gap:6px;margin:6px 0 10px"><button type="button" class="btn btn-sm" id="tf-sms-paste">${ICON.clip} 클립보드에서 붙여넣기</button><button type="button" class="btn btn-sm btn-primary" id="tf-sms-parse">읽어오기</button></div></div>
      <div class="amount-wrap ${f.type === 'income' ? 'inc' : 'exp'}" id="tf-amount-wrap"><input class="input num" id="tf-amount" data-amount inputmode="numeric" placeholder="0" value="${fmtInput(f.amount)}" aria-label="금액" /><span class="unit">원</span></div>
      <div class="quick-amt" id="tf-quick"><button type="button" data-add="10000">+1만</button><button type="button" data-add="50000">+5만</button><button type="button" data-add="100000">+10만</button><button type="button" data-add="1000000">+100만</button><button type="button" data-add="0">지우기</button></div>
    </div>
    <div class="field"><label for="tf-memo">내용</label><input class="input" id="tf-memo" placeholder="예: 이마트 장보기" autocomplete="off" maxlength="40" value="${esc(f.memo)}" /><div class="suggest" id="tf-suggest"></div></div>
    <div class="field"><div class="lab">카테고리</div>${catGrid('expense', f.type !== 'income' ? f.cat : '', 'tf-cat-expense')}${catGrid('income', f.type === 'income' ? f.cat : '', 'tf-cat-income')}</div>
    <div class="field"><div class="lab">누가</div>${personPicks(f.person || 'both', 'tf-person')}</div>
    <div class="field ${f.type === 'income' ? 'hidden' : ''}" id="tf-pay-field"><div class="lab">결제수단</div>${payPicks(f.pay, 'tf-pay')}</div>
    <div class="field"><div class="lab">날짜</div><div style="display:flex;gap:6px"><input type="date" class="input" id="tf-date" value="${esc(f.date)}" style="flex:1" /><button type="button" class="pick" data-dd="0">오늘</button><button type="button" class="pick" data-dd="-1">어제</button></div></div>
    ${isNew ? `<label class="check-row"><span><b>🔁 매달 반복</b><span>고정지출로 등록해서 매달 이 날짜에 자동 입력</span></span><span class="toggle"><input type="checkbox" id="tf-repeat" /><span></span></span></label>` : ''}
    ${ex?.recurringId ? '<div class="help">🔁 고정지출에서 자동으로 입력된 내역이에요.</div>' : ''}
    ${ex?.by ? `<div class="help">${person(ex.by).emoji} ${esc(person(ex.by).name)}이(가) 입력 · ${relTime(ex.updatedAt)} 수정</div>` : ''}`;
  const foot = isNew
    ? `<button type="button" class="btn" id="tf-save-more">저장 후 계속</button><button type="button" class="btn btn-primary" id="tf-save">저장</button>`
    : `<button type="button" class="btn btn-danger" id="tf-del" style="flex:0 0 auto;padding:0 16px" aria-label="삭제">${ICON.trash}</button><button type="button" class="btn" id="tf-copy" style="flex:0 0 auto">복제</button><button type="button" class="btn btn-primary" id="tf-save">저장</button>`;

  const el = openSheet({ title: ex ? '내역 수정' : '새 내역 입력', body, foot });
  bindAmountInputs(el);
  const amountEl = $('#tf-amount', el), memoEl = $('#tf-memo', el), dateEl = $('#tf-date', el);

  const applyType = (t) => {
    f.type = t;
    setPick(el, '#tf-type', t);
    $('#tf-cat-expense', el).classList.toggle('hidden', t === 'income');
    $('#tf-cat-income', el).classList.toggle('hidden', t !== 'income');
    $('#tf-pay-field', el).classList.toggle('hidden', t === 'income');
    $('#tf-bills', el)?.classList.toggle('hidden', t === 'income');
    $('#tf-amount-wrap', el).className = 'amount-wrap ' + (t === 'income' ? 'inc' : 'exp');
    const grid = $(t === 'income' ? '#tf-cat-income' : '#tf-cat-expense', el);
    if (!$('button.on', grid)) { f.cat = t === 'income' ? 'salary' : 'food'; setPick(el, t === 'income' ? '#tf-cat-income' : '#tf-cat-expense', f.cat); }
    else f.cat = $('button.on', grid).dataset.v;
    renderSuggest();
  };
  applyType(f.type);
  bindPick(el, '#tf-type', applyType);
  bindPick(el, '#tf-cat-expense', (v) => { f.cat = v; catTouched = true; });
  bindPick(el, '#tf-cat-income', (v) => { f.cat = v; catTouched = true; });
  bindPick(el, '#tf-person', (v) => { f.person = v; });
  bindPick(el, '#tf-pay', (v) => { f.pay = v; });

  $('#tf-bills', el)?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    const p = b.dataset.p;
    Object.assign(f, { cat: 'card', person: p, pay: 'bank' });
    catTouched = true;
    setPick(el, '#tf-cat-expense', 'card'); setPick(el, '#tf-person', p); setPick(el, '#tf-pay', 'bank');
    memoEl.value = `${names()[p]} 카드값`;
    amountEl.focus();
  });

  $('#tf-quick', el).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-add]');
    if (!b) return;
    const add = Number(b.dataset.add);
    const v = add ? parseAmount(amountEl.value) + add : 0;
    amountEl.value = v ? v.toLocaleString('ko-KR') : '';
  });

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-dd]');
    if (!b) return;
    dateEl.value = ymd(new Date(Date.now() + Number(b.dataset.dd) * 864e5));
  });

  // 문자 입력
  const smsBox = $('#tf-sms-box', el);
  $('#tf-sms', el)?.addEventListener('click', () => { smsBox.classList.toggle('hidden'); if (!smsBox.classList.contains('hidden')) $('#tf-sms-text', el).focus(); });
  $('#tf-sms-paste', el)?.addEventListener('click', async () => {
    try { $('#tf-sms-text', el).value = await navigator.clipboard.readText(); applySms(); } catch { toast('클립보드 접근이 막혀 있어요. 길게 눌러 붙여넣어 주세요'); }
  });
  const applySms = () => {
    const r = parseSms($('#tf-sms-text', el).value);
    if (!r) { toast('문자에서 금액을 찾지 못했어요'); return; }
    applyType('expense');
    amountEl.value = r.amount.toLocaleString('ko-KR');
    if (r.date) dateEl.value = r.date;
    if (r.memo) { memoEl.value = r.memo; autoCat(true); }
    f.pay = r.pay; setPick(el, '#tf-pay', r.pay);
    smsBox.classList.add('hidden');
    toast(r.cancel ? '⚠️ 취소 문자예요. 금액을 확인해 주세요' : '✨ 문자에서 읽어왔어요');
  };
  $('#tf-sms-parse', el)?.addEventListener('click', applySms);

  // 메모 자동완성 → 카테고리/결제수단 자동 선택
  function renderSuggest() {
    const q = memoEl.value.trim().toLowerCase();
    const list = [...idx.values()].filter((e) => e.type === typeKey(f.type) && (!q || e.memo.toLowerCase().includes(q)) && e.memo !== memoEl.value.trim())
      .sort((a, b) => b.n - a.n).slice(0, 8);
    $('#tf-suggest', el).innerHTML = list.map((e) => `<button type="button" data-memo="${esc(e.memo)}">${cat(e.type, e.cat).emoji} ${esc(e.memo)}</button>`).join('');
  }
  function autoCat(force = false) {
    const e = idx.get(typeKey(f.type) + '|' + memoEl.value.trim());
    if (!e) return false;
    if (!catTouched || force) { f.cat = e.cat; setPick(el, f.type === 'income' ? '#tf-cat-income' : '#tf-cat-expense', e.cat); }
    if (e.pay && f.type !== 'income') { f.pay = e.pay; setPick(el, '#tf-pay', e.pay); }
    return e;
  }
  memoEl.addEventListener('input', renderSuggest);
  memoEl.addEventListener('change', () => autoCat());
  $('#tf-suggest', el).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-memo]');
    if (!b) return;
    memoEl.value = b.dataset.memo;
    const hit = autoCat(true);
    if (hit && !parseAmount(amountEl.value)) amountEl.value = num(hit.amount);
    renderSuggest();
  });
  renderSuggest();

  const collect = () => {
    const amount = Math.round(parseAmount(amountEl.value));
    if (!(amount > 0)) { toast('금액을 입력해 주세요'); amountEl.focus(); return null; }
    if (!dateEl.value) { toast('날짜를 선택해 주세요'); return null; }
    const rec = { ...(ex || {}), type: f.type === 'income' ? 'income' : 'expense', amount, memo: memoEl.value.trim(), cat: f.cat, person: f.person || 'both', date: dateEl.value };
    if (rec.type === 'expense') rec.pay = f.pay || ''; else delete rec.pay;
    if (!ex) rec.id = uid();
    return rec;
  };
  const noteOf = (r) => `${r.type === 'income' ? '수입' : '지출'} ${r.memo || cat(r.type, r.cat).name} ${num(r.amount)}원`;

  const save = (more) => {
    const rec = collect();
    if (!rec) return;
    const repeat = $('#tf-repeat', el)?.checked;
    if (repeat) {
      const rule = { id: uid(), type: rec.type, amount: rec.amount, memo: rec.memo, cat: rec.cat, person: rec.person, pay: rec.pay || '', day: parseYmd(rec.date).getDate(), start: rec.date.slice(0, 7), active: true };
      rec.id = recTxId(rule.id, rec.date.slice(0, 7));
      rec.recurringId = rule.id;
      batch(() => { upsert('recurring', rule); upsert('tx', rec); }, `고정 등록 ${rule.memo || cat(rule.type, rule.cat).name} ${num(rule.amount)}원`);
    } else {
      upsert('tx', rec, (ex ? '수정 ' : '') + noteOf(rec));
    }
    if (more) {
      toast('✓ 저장했어요. 계속 입력하세요');
      amountEl.value = ''; memoEl.value = '';
      if ($('#tf-repeat', el)) $('#tf-repeat', el).checked = false;
      renderSuggest();
      amountEl.focus();
    } else {
      closeSheet();
      toast(ex ? '✓ 수정했어요' : `✓ ${rec.type === 'income' ? '수입' : '지출'} ${num(rec.amount)}원 저장`);
    }
  };
  $('#tf-save', el).addEventListener('click', () => save(false));
  $('#tf-save-more', el)?.addEventListener('click', () => save(true));
  $('#tf-del', el)?.addEventListener('click', () => {
    const prev = { ...ex };
    remove('tx', ex.id, '삭제 ' + noteOf(ex));
    closeSheet();
    toast('🗑️ 삭제했어요', { action: { label: '되돌리기', fn: () => upsert('tx', prev, '복구 ' + noteOf(prev)) } });
  });
  $('#tf-copy', el)?.addEventListener('click', () => {
    const rec = collect();
    if (!rec) return;
    const { id: _i, recurringId: _r, createdAt: _c, updatedAt: _u, by: _b, ...rest } = rec;
    openTxForm({ copyFrom: rest });
  });
  amountEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(false); });
  if (isNew && !preset) setTimeout(() => amountEl.focus(), 280);
  if (preset) setTimeout(() => amountEl.focus(), 280);
}

// ===== 자산(투자·예적금) =====
export function openInvestForm({ id, kind } = {}) {
  const ex = id ? get('invest', id) : null;
  const f = ex ? { ...ex } : { type: kind === 'other' ? 'saving' : 'stock', person: me(), qty: '', avg: '', symbol: '', name: '', currency: 'KRW' };
  const market = assetType(f.type).market;
  const otherTypes = ASSET_TYPES.filter((a) => !a.market);
  let body;
  if (market) {
    body = `
      <div class="field"><label for="if-q">종목 검색</label><input class="input" id="if-q" placeholder="예: 삼성전자, 애플, TIGER 미국S&P500, 비트코인" autocomplete="off" />
        <div class="search-results" id="if-results"></div></div>
      <div class="info-box" id="if-picked">${f.symbol ? '' : '검색해서 종목을 골라 주세요. 한국·미국 주식, ETF, 코인 모두 돼요.'}</div>
      <div class="row2">
        <div class="field"><label for="if-qty">보유 수량</label><input class="input num" id="if-qty" data-amount="dec" inputmode="decimal" value="${fmtInput(f.qty)}" placeholder="0" /></div>
        <div class="field"><label for="if-avg" id="if-avg-label">평균 매입가 (원)</label><input class="input num" id="if-avg" data-amount="dec" inputmode="decimal" value="${fmtInput(f.avg)}" placeholder="0" /></div>
      </div>
      <div class="field hidden" id="if-fx-field"><label for="if-fx">매입 당시 환율 (1달러 = ?원)</label><input class="input num" id="if-fx" data-amount="dec" inputmode="decimal" value="${fmtInput(f.buyFx || '')}" placeholder="${Math.round(krwPer('USD'))}" /><div class="help">비워두면 현재 환율로 계산해요</div></div>
      <div class="field"><div class="lab">누구 것</div>${personPicks(f.person || 'both', 'if-person')}</div>
      <details class="more" ${f.manualPrice ? 'open' : ''}><summary>시세가 안 나올 때: 현재가 직접 입력 ▾</summary><div class="field" style="margin-top:8px"><input class="input num" id="if-manual" data-amount="dec" inputmode="decimal" value="${fmtInput(f.manualPrice || '')}" placeholder="비워두면 실시간 시세 사용" /></div></details>`;
  } else {
    body = `
      <div class="field"><div class="lab">종류</div><div class="pick-row" id="if-type">${otherTypes.map((a) => `<button type="button" class="pick ${a.key === f.type ? 'on' : ''}" data-v="${a.key}">${a.emoji} ${a.name}</button>`).join('')}</div></div>
      <div class="field"><label for="if-name">이름</label><input class="input" id="if-name" value="${esc(f.name)}" placeholder="예: 청년도약계좌, 전세보증금, 비상금 통장" maxlength="30" /></div>
      <div class="field"><label for="if-amount">현재 금액</label><div class="amount-wrap"><input class="input num" id="if-amount" data-amount inputmode="numeric" value="${fmtInput(f.amount)}" placeholder="0" /><span class="unit">원</span></div></div>
      <div class="field"><label for="if-principal">넣은 원금 (선택)</label><input class="input num" id="if-principal" data-amount inputmode="numeric" value="${fmtInput(f.principal)}" placeholder="이자·수익 계산용" /></div>
      <div class="field"><label for="if-note">메모 (선택)</label><input class="input" id="if-note" value="${esc(f.note || '')}" placeholder="예: 만기 2027-03, 월 50만원 납입" maxlength="40" /></div>
      <div class="field"><div class="lab">누구 것</div>${personPicks(f.person || 'both', 'if-person')}</div>`;
  }
  const foot = (ex ? `<button type="button" class="btn btn-danger" id="if-del" style="flex:0 0 auto;padding:0 16px" aria-label="삭제">${ICON.trash}</button>` : '') + '<button type="button" class="btn btn-primary" id="if-save">저장</button>';
  const el = openSheet({ title: ex ? '자산 수정' : market ? '주식·코인 추가' : '자산 추가', body, foot });
  bindAmountInputs(el);
  bindPick(el, '#if-person', (v) => { f.person = v; });
  bindPick(el, '#if-type', (v) => { f.type = v; });

  const showPicked = () => {
    const box = $('#if-picked', el);
    if (!box || !f.symbol) return;
    const q = getQuote(f.symbol);
    const foreign = (q?.currency || f.currency) && (q?.currency || f.currency) !== 'KRW';
    $('#if-avg-label', el).textContent = `평균 매입가 (${foreign ? (q?.currency || f.currency) : '원'})`;
    $('#if-fx-field', el).classList.toggle('hidden', !foreign);
    box.innerHTML = `<b>${esc(f.name)}</b> <span class="muted">${esc(symbolLabel(f.symbol))}</span><br>` + (q
      ? `현재가 <b class="num">${won(q.price * krwPer(q.currency))}</b>${foreign ? ` <span class="muted num">(${q.currency} ${fmtDec(q.price, 4)})</span>` : ''} · <span class="${q.change >= 0 ? 'up' : 'down'}">${q.change >= 0 ? '▲' : '▼'}${Math.abs(q.pct).toFixed(2)}%</span>`
      : '<span class="muted">현재가 불러오는 중…</span>');
  };
  if (market && f.symbol) {
    showPicked();
    refreshQuotes([f.symbol]).then(showPicked);
  }
  const qEl = $('#if-q', el);
  if (qEl) {
    const results = $('#if-results', el);
    const run = debounce(async () => {
      const q = qEl.value.trim();
      if (!q) { results.innerHTML = ''; return; }
      results.innerHTML = '<div class="small muted" style="padding:8px">검색 중…</div>';
      const list = await searchSymbols(q);
      if (qEl.value.trim() !== q) return;
      results.innerHTML = list.length ? list.map((r, i) => `<button type="button" data-i="${i}"><span><span class="nm">${esc(r.name)}</span><br><span class="mk">${esc(r.code)} · ${esc(r.market)}</span></span><span class="mk">선택 →</span></button>`).join('')
        : '<div class="small muted" style="padding:8px">검색 결과가 없어요. 이름이나 종목코드(005930)로 다시 검색해 보세요.</div>';
      results.onclick = async (e) => {
        const b = e.target.closest('button[data-i]');
        if (!b) return;
        const r = list[Number(b.dataset.i)];
        Object.assign(f, { symbol: r.symbol, name: r.name, type: r.type });
        results.innerHTML = '';
        qEl.value = '';
        $('#if-picked', el).innerHTML = `<b>${esc(r.name)}</b> <span class="muted">${esc(r.code)}</span><br><span class="muted">현재가 불러오는 중…</span>`;
        await refreshQuotes([r.symbol]);
        const q = getQuote(r.symbol);
        if (q) f.currency = q.currency;
        if (q && !parseAmount($('#if-avg', el).value)) $('#if-avg', el).value = fmtInput(q.price);
        showPicked();
        $('#if-qty', el).focus();
      };
    }, 350);
    qEl.addEventListener('input', run);
    if (!ex) setTimeout(() => qEl.focus(), 280);
  }

  $('#if-save', el).addEventListener('click', () => {
    const rec = { ...f };
    if (market) {
      if (!rec.symbol) { toast('종목을 먼저 검색해서 골라 주세요'); return; }
      rec.qty = parseAmount($('#if-qty', el).value);
      rec.avg = parseAmount($('#if-avg', el).value);
      if (!(rec.qty > 0)) { toast('보유 수량을 입력해 주세요'); return; }
      const fx = parseAmount($('#if-fx', el).value);
      if (rec.currency && rec.currency !== 'KRW') rec.buyFx = fx || rec.buyFx || Math.round(krwPer(rec.currency) * 100) / 100; else delete rec.buyFx;
      const mp = parseAmount($('#if-manual', el).value);
      if (mp > 0) rec.manualPrice = mp; else delete rec.manualPrice;
    } else {
      rec.name = $('#if-name', el).value.trim();
      rec.amount = parseAmount($('#if-amount', el).value);
      rec.principal = parseAmount($('#if-principal', el).value) || 0;
      rec.note = $('#if-note', el).value.trim();
      if (!rec.name) { toast('이름을 입력해 주세요'); return; }
    }
    upsert('invest', rec, `${ex ? '자산 수정' : '자산 추가'} ${rec.name || symbolLabel(rec.symbol)}`);
    closeSheet();
    toast('✓ 저장했어요');
  });
  $('#if-del', el)?.addEventListener('click', async () => {
    if (!(await confirmSheet({ title: '자산 삭제', message: `“${esc(ex.name)}”을(를) 삭제할까요?`, ok: '삭제', danger: true }))) return;
    remove('invest', ex.id, `자산 삭제 ${ex.name}`);
    toast('🗑️ 삭제했어요');
  });
}

// ===== 대출 =====
export function openLoanForm({ id } = {}) {
  const ex = id ? get('loans', id) : null;
  const f = ex ? { ...ex } : { type: 'jeonse', person: 'both', name: '', principal: 0, remaining: 0, rate: '', monthly: 0, start: '', end: '' };
  const body = `
    <div class="field"><div class="lab">종류</div><div class="pick-row" id="lf-type">${LOAN_TYPES.map((a) => `<button type="button" class="pick ${a.key === f.type ? 'on' : ''}" data-v="${a.key}">${a.emoji} ${a.name}</button>`).join('')}</div></div>
    <div class="field"><label for="lf-name">이름</label><input class="input" id="lf-name" value="${esc(f.name)}" placeholder="예: 청년 버팀목 전세대출" maxlength="30" /></div>
    <div class="row2">
      <div class="field"><label for="lf-principal">대출 원금</label><input class="input num" id="lf-principal" data-amount inputmode="numeric" value="${fmtInput(f.principal)}" placeholder="0" /></div>
      <div class="field"><label for="lf-remaining">남은 잔액</label><input class="input num" id="lf-remaining" data-amount inputmode="numeric" value="${fmtInput(f.remaining)}" placeholder="0" /></div>
    </div>
    <div class="row2">
      <div class="field"><label for="lf-rate">연 이자율 (%)</label><input class="input num" id="lf-rate" data-amount="dec" inputmode="decimal" value="${fmtInput(f.rate)}" placeholder="3.5" /></div>
      <div class="field"><label for="lf-monthly">월 상환액</label><input class="input num" id="lf-monthly" data-amount inputmode="numeric" value="${fmtInput(f.monthly)}" placeholder="0" /></div>
    </div>
    <div class="row2">
      <div class="field"><label for="lf-start">시작일</label><input class="input" type="date" id="lf-start" value="${esc(f.start)}" /></div>
      <div class="field"><label for="lf-end">만기일</label><input class="input" type="date" id="lf-end" value="${esc(f.end)}" /></div>
    </div>
    <div class="field"><div class="lab">누구 명의</div>${personPicks(f.person || 'both', 'lf-person')}</div>`;
  const foot = (ex ? `<button type="button" class="btn btn-danger" id="lf-del" style="flex:0 0 auto;padding:0 16px" aria-label="삭제">${ICON.trash}</button>` : '') + '<button type="button" class="btn btn-primary" id="lf-save">저장</button>';
  const el = openSheet({ title: ex ? '대출 수정' : '대출 추가', body, foot });
  bindAmountInputs(el);
  bindPick(el, '#lf-type', (v) => { f.type = v; });
  bindPick(el, '#lf-person', (v) => { f.person = v; });
  $('#lf-principal', el).addEventListener('change', () => { if (!parseAmount($('#lf-remaining', el).value)) $('#lf-remaining', el).value = $('#lf-principal', el).value; });
  $('#lf-save', el).addEventListener('click', () => {
    const rec = { ...f, name: $('#lf-name', el).value.trim(), principal: parseAmount($('#lf-principal', el).value), remaining: parseAmount($('#lf-remaining', el).value), rate: parseAmount($('#lf-rate', el).value), monthly: parseAmount($('#lf-monthly', el).value), start: $('#lf-start', el).value, end: $('#lf-end', el).value };
    if (!(rec.remaining > 0) && !(rec.principal > 0)) { toast('금액을 입력해 주세요'); return; }
    if (!rec.remaining) rec.remaining = rec.principal;
    if (!rec.principal) rec.principal = rec.remaining;
    upsert('loans', rec, `${ex ? '대출 수정' : '대출 추가'} ${rec.name || ''}`);
    closeSheet();
    toast('✓ 저장했어요');
  });
  $('#lf-del', el)?.addEventListener('click', async () => {
    if (!(await confirmSheet({ title: '대출 삭제', message: `“${esc(ex.name)}”을(를) 삭제할까요?`, ok: '삭제', danger: true }))) return;
    remove('loans', ex.id, `대출 삭제 ${ex.name}`);
    toast('🗑️ 삭제했어요');
  });
}

// ===== 목표 저축 =====
const GOAL_EMOJI = ['🏡', '✈️', '🚗', '💍', '👶', '🐶', '💰', '🎓', '🛋️', '🎁', '🏥', '🎯'];
export function openGoalForm({ id } = {}) {
  const ex = id ? get('goals', id) : null;
  const f = ex ? { ...ex } : { emoji: '🏡', name: '', target: 0, initial: 0, deadline: '' };
  const body = `
    <div class="field"><div class="lab">아이콘</div><div class="pick-row" id="gf-emoji">${GOAL_EMOJI.map((e) => `<button type="button" class="pick ${e === f.emoji ? 'on' : ''}" data-v="${e}" style="font-size:20px;padding:0 10px">${e}</button>`).join('')}</div></div>
    <div class="field"><label for="gf-name">목표 이름</label><input class="input" id="gf-name" value="${esc(f.name)}" placeholder="예: 내 집 마련, 결혼 1주년 여행" maxlength="30" /></div>
    <div class="row2">
      <div class="field"><label for="gf-target">목표 금액</label><input class="input num" id="gf-target" data-amount inputmode="numeric" value="${fmtInput(f.target)}" placeholder="0" /></div>
      <div class="field"><label for="gf-initial">이미 모은 돈</label><input class="input num" id="gf-initial" data-amount inputmode="numeric" value="${fmtInput(f.initial)}" placeholder="0" /></div>
    </div>
    <div class="field"><label for="gf-deadline">목표 시점 (선택)</label><input class="input" type="month" id="gf-deadline" value="${esc(f.deadline)}" /></div>`;
  const foot = (ex ? `<button type="button" class="btn btn-danger" id="gf-del" style="flex:0 0 auto;padding:0 16px" aria-label="삭제">${ICON.trash}</button>` : '') + '<button type="button" class="btn btn-primary" id="gf-save">저장</button>';
  const el = openSheet({ title: ex ? '목표 수정' : '새 목표', body, foot });
  bindAmountInputs(el);
  bindPick(el, '#gf-emoji', (v) => { f.emoji = v; });
  $('#gf-save', el).addEventListener('click', () => {
    const rec = { ...f, name: $('#gf-name', el).value.trim(), target: parseAmount($('#gf-target', el).value), initial: parseAmount($('#gf-initial', el).value), deadline: $('#gf-deadline', el).value };
    if (!rec.name) { toast('목표 이름을 입력해 주세요'); return; }
    if (!(rec.target > 0)) { toast('목표 금액을 입력해 주세요'); return; }
    upsert('goals', rec, `목표 ${ex ? '수정' : '추가'} ${rec.name}`);
    closeSheet();
    toast('✓ 저장했어요');
  });
  $('#gf-del', el)?.addEventListener('click', async () => {
    if (!(await confirmSheet({ title: '목표 삭제', message: `“${esc(ex.name)}” 목표와 적립 기록을 삭제할까요?`, ok: '삭제', danger: true }))) return;
    batch(() => { remove('goals', ex.id); all('goalLogs').filter((l) => l.goalId === ex.id).forEach((l) => remove('goalLogs', l.id)); }, `목표 삭제 ${ex.name}`);
    toast('🗑️ 삭제했어요');
  });
}

export function openGoalDeposit({ id }) {
  const g = get('goals', id);
  if (!g) return;
  const logs = all('goalLogs').filter((l) => l.goalId === id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const body = `
    <div class="info-box">${esc(g.emoji)} <b>${esc(g.name)}</b> · 지금까지 <b class="num">${won(goalCurrent(g))}</b> / ${won(g.target)}</div>
    <div class="field"><label for="gd-amount">이번에 모은 금액 (빼려면 앞에 - 입력)</label><div class="amount-wrap inc"><input class="input num" id="gd-amount" inputmode="numeric" placeholder="0" /><span class="unit">원</span></div></div>
    <div class="row2"><div class="field"><label for="gd-date">날짜</label><input class="input" type="date" id="gd-date" value="${today()}" /></div><div class="field"><div class="lab">누가</div>${personPicks(me(), 'gd-person')}</div></div>
    ${logs.length ? `<div class="lab small" style="font-weight:700;margin:6px 0">적립 기록</div><div class="tbl-wrap"><table class="tbl num"><tbody>${logs.slice(0, 30).map((l) => `<tr><td>${esc(l.date)}</td><td>${person(l.person).emoji}</td><td>${num(l.amount)}원</td><td style="width:40px"><button type="button" class="icon-btn" data-del="${esc(l.id)}" aria-label="삭제" style="width:30px;height:30px">${ICON.trash}</button></td></tr>`).join('')}</tbody></table></div>` : ''}`;
  const el = openSheet({ title: '목표 적립', body, foot: '<button type="button" class="btn btn-primary" id="gd-save">적립하기</button>' });
  let who = me();
  bindPick(el, '#gd-person', (v) => { who = v; });
  const amt = $('#gd-amount', el);
  amt.addEventListener('input', () => {
    const neg = amt.value.trim().startsWith('-');
    const d = amt.value.replace(/[^\d]/g, '');
    amt.value = (neg ? '-' : '') + (d ? Number(d).toLocaleString('ko-KR') : '');
  });
  setTimeout(() => amt.focus(), 280);
  $('#gd-save', el).addEventListener('click', () => {
    const v = parseAmount(amt.value);
    if (!v) { toast('금액을 입력해 주세요'); return; }
    upsert('goalLogs', { id: uid(), goalId: id, amount: v, date: $('#gd-date', el).value || today(), person: who }, `목표 적립 ${g.name} ${num(v)}원`);
    closeSheet();
    toast(`🎯 ${num(v)}원 적립!`);
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-del]');
    if (!b) return;
    remove('goalLogs', b.dataset.del, `적립 취소 ${g.name}`);
    b.closest('tr').remove();
  });
}

// ===== 고정 지출·수입 =====
export function openRecurringForm({ id } = {}) {
  const ex = id ? get('recurring', id) : null;
  const f = ex ? { ...ex } : { type: 'expense', amount: 0, memo: '', cat: 'home', person: 'both', pay: 'bank', day: new Date().getDate(), start: ym(), active: true };
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const body = `
    <div class="seg full big" id="rf-type"><button type="button" class="exp ${f.type !== 'income' ? 'on' : ''}" data-v="expense">고정 지출</button><button type="button" class="inc ${f.type === 'income' ? 'on' : ''}" data-v="income">고정 수입</button></div>
    <div style="height:14px"></div>
    <div class="field"><label for="rf-amount">금액</label><div class="amount-wrap"><input class="input num" id="rf-amount" data-amount inputmode="numeric" value="${fmtInput(f.amount)}" placeholder="0" /><span class="unit">원</span></div></div>
    <div class="field"><label for="rf-memo">내용</label><input class="input" id="rf-memo" value="${esc(f.memo)}" placeholder="예: 관리비, 넷플릭스, 남편 카드값, 월급" maxlength="40" /></div>
    <div class="field"><div class="lab">카테고리</div>${catGrid('expense', f.type !== 'income' ? f.cat : '', 'rf-cat-expense')}${catGrid('income', f.type === 'income' ? f.cat : '', 'rf-cat-income')}</div>
    <div class="row2">
      <div class="field"><label for="rf-day">매달 며칠</label><select class="input" id="rf-day">${days.map((d) => `<option value="${d}" ${Number(f.day) === d ? 'selected' : ''}>${d === 31 ? '말일' : d + '일'}</option>`).join('')}</select></div>
      <div class="field"><label for="rf-start">시작 월</label><input class="input" type="month" id="rf-start" value="${esc(f.start || ym())}" /></div>
    </div>
    <div class="field"><div class="lab">누가</div>${personPicks(f.person, 'rf-person')}</div>
    <div class="field" id="rf-pay-field"><div class="lab">결제수단</div>${payPicks(f.pay, 'rf-pay')}</div>
    <label class="check-row"><span><b>사용 중</b><span>끄면 자동 입력을 잠시 멈춰요</span></span><span class="toggle"><input type="checkbox" id="rf-active" ${f.active !== false ? 'checked' : ''} /><span></span></span></label>
    <div class="help">등록한 날부터 매달 그 날짜가 되면 내역에 자동으로 들어가요. (두 사람 폰에서 중복 입력되지 않아요)</div>`;
  const foot = (ex ? `<button type="button" class="btn btn-danger" id="rf-del" style="flex:0 0 auto;padding:0 16px" aria-label="삭제">${ICON.trash}</button>` : '') + '<button type="button" class="btn btn-primary" id="rf-save">저장</button>';
  const el = openSheet({ title: ex ? '고정 항목 수정' : '고정 항목 추가', body, foot });
  bindAmountInputs(el);
  const applyType = (t) => {
    f.type = t;
    $('#rf-cat-expense', el).classList.toggle('hidden', t === 'income');
    $('#rf-cat-income', el).classList.toggle('hidden', t !== 'income');
    $('#rf-pay-field', el).classList.toggle('hidden', t === 'income');
    const grid = $(t === 'income' ? '#rf-cat-income' : '#rf-cat-expense', el);
    if (!$('button.on', grid)) { f.cat = t === 'income' ? 'salary' : 'home'; setPick(el, t === 'income' ? '#rf-cat-income' : '#rf-cat-expense', f.cat); } else f.cat = $('button.on', grid).dataset.v;
  };
  applyType(f.type);
  bindPick(el, '#rf-type', applyType);
  bindPick(el, '#rf-cat-expense', (v) => { f.cat = v; });
  bindPick(el, '#rf-cat-income', (v) => { f.cat = v; });
  bindPick(el, '#rf-person', (v) => { f.person = v; });
  bindPick(el, '#rf-pay', (v) => { f.pay = v; });
  $('#rf-save', el).addEventListener('click', () => {
    const rec = { ...f, amount: Math.round(parseAmount($('#rf-amount', el).value)), memo: $('#rf-memo', el).value.trim(), day: Number($('#rf-day', el).value), start: $('#rf-start', el).value || ym(), active: $('#rf-active', el).checked };
    if (rec.type === 'income') rec.pay = '';
    if (!(rec.amount > 0)) { toast('금액을 입력해 주세요'); return; }
    if (!ex && rec.start === ym() && rec.day < new Date().getDate()) {
      // 이번 달 날짜가 이미 지났으면 중복 입력을 막기 위해 다음 달부터 자동 입력
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1);
      rec.start = ym(d);
      toast('이번 달 날짜는 지나서 다음 달부터 자동 입력돼요', { ms: 3500 });
    }
    upsert('recurring', rec, `고정 ${ex ? '수정' : '등록'} ${rec.memo || cat(rec.type, rec.cat).name} ${num(rec.amount)}원`);
    closeSheet();
    toast('✓ 저장했어요');
  });
  $('#rf-del', el)?.addEventListener('click', async () => {
    if (!(await confirmSheet({ title: '고정 항목 삭제', message: '이미 입력된 내역은 그대로 두고, 앞으로의 자동 입력만 멈춰요.', ok: '삭제', danger: true }))) return;
    remove('recurring', ex.id, `고정 삭제 ${ex.memo || ''}`);
    toast('🗑️ 삭제했어요');
  });
}

// ===== 예산 =====
export function openBudgetSheet() {
  const cats = catList('expense');
  const body = `
    <div class="field"><label for="bf-total">한 달 전체 예산</label><div class="amount-wrap exp"><input class="input num" id="bf-total" data-amount inputmode="numeric" value="${fmtInput(budgetTotal())}" placeholder="0" /><span class="unit">원</span></div><div class="help">홈 화면에서 남은 예산과 “하루에 쓸 수 있는 돈”을 보여줘요</div></div>
    <div class="lab small" style="font-weight:700;margin:16px 0 8px;color:var(--ink-2)">카테고리별 예산 (선택)</div>
    ${cats.map((c) => `<div class="set-row" style="padding:8px 2px;min-height:auto"><div class="lbl"><b>${c.emoji} ${esc(c.name)}</b></div><input class="input num" data-cat="${esc(c.key)}" data-amount inputmode="numeric" value="${fmtInput(budgetCat(c.key))}" placeholder="0" style="max-width:150px;height:40px;text-align:right" /></div>`).join('')}`;
  const el = openSheet({ title: '🎯 예산 설정', body, foot: '<button type="button" class="btn btn-primary" id="bf-save">저장</button>' });
  bindAmountInputs(el);
  $('#bf-save', el).addEventListener('click', () => {
    batch(() => {
      const tot = parseAmount($('#bf-total', el).value);
      if (tot !== budgetTotal()) setKV('budget.total', tot);
      $$('input[data-cat]', el).forEach((i) => { const v = parseAmount(i.value); if (v !== budgetCat(i.dataset.cat)) setKV('budget.cat.' + i.dataset.cat, v); });
    }, '예산 변경');
    closeSheet();
    toast('✓ 예산을 저장했어요');
  });
}

// ===== 카테고리 =====
export function openCatsSheet(type = 'expense') {
  const all_ = catList(type, { includeHidden: true });
  const hidden = new Set(kv(`cats.${type}.hidden`, []) || []);
  const custom = kv(`cats.${type}.custom`, []) || [];
  const isCustom = (k) => custom.some((c) => c.key === k);
  const body = `
    <div class="seg full" id="cs-type" style="margin-bottom:12px"><button type="button" class="${type === 'expense' ? 'on' : ''}" data-v="expense">지출</button><button type="button" class="${type === 'income' ? 'on' : ''}" data-v="income">수입</button></div>
    <div class="set-list">${all_.map((c) => `<div class="set-row" style="padding:8px 2px;min-height:auto"><div class="lbl"><b>${c.emoji} ${esc(c.name)}</b>${isCustom(c.key) ? '<span>직접 만든 카테고리</span>' : ''}</div>
      ${isCustom(c.key) ? `<button type="button" class="icon-btn" data-delcat="${esc(c.key)}" aria-label="삭제">${ICON.trash}</button>` : ''}
      ${c.key === 'etc' ? '<span class="tiny muted">항상 표시</span>' : `<label class="toggle"><input type="checkbox" data-cat="${esc(c.key)}" ${hidden.has(c.key) ? '' : 'checked'} /><span></span></label>`}</div>`).join('')}</div>
    <div class="lab small" style="font-weight:700;margin:16px 0 8px;color:var(--ink-2)">새 카테고리 만들기</div>
    <div style="display:flex;gap:8px"><input class="input" id="cs-emoji" placeholder="🙂" maxlength="4" style="width:64px;text-align:center" /><input class="input" id="cs-name" placeholder="예: 반려견, 부모님 용돈" maxlength="12" /><button type="button" class="btn btn-primary" id="cs-add">추가</button></div>
    <div class="help">숨긴 카테고리는 입력 화면에서만 안 보이고, 예전 내역은 그대로 남아요.</div>`;
  const el = openSheet({ title: '카테고리 관리', body });
  bindPick(el, '#cs-type', (v) => openCatsSheet(v));
  el.addEventListener('change', (e) => {
    const i = e.target.closest('input[data-cat]');
    if (!i) return;
    const h = new Set(kv(`cats.${type}.hidden`, []) || []);
    if (i.checked) h.delete(i.dataset.cat); else h.add(i.dataset.cat);
    setKV(`cats.${type}.hidden`, [...h], '카테고리 표시 변경');
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-delcat]');
    if (!b) return;
    setKV(`cats.${type}.custom`, (kv(`cats.${type}.custom`, []) || []).filter((c) => c.key !== b.dataset.delcat), '카테고리 삭제');
    openCatsSheet(type);
  });
  $('#cs-add', el).addEventListener('click', () => {
    const name = $('#cs-name', el).value.trim();
    const emoji = $('#cs-emoji', el).value.trim() || '🏷️';
    if (!name) { toast('이름을 입력해 주세요'); return; }
    setKV(`cats.${type}.custom`, [...(kv(`cats.${type}.custom`, []) || []), { key: 'c_' + uid(), name, emoji }], `카테고리 추가 ${name}`);
    toast(`✓ ${emoji} ${name} 추가`);
    openCatsSheet(type);
  });
}

// ===== 동기화 연결 =====
export function openSyncSheet({ onDone } = {}) {
  const cur = syncConfig() || DEFAULT_REPO;
  const body = `
    <div class="info-box">두 사람의 기록을 <b>나만 볼 수 있는 비공개 GitHub 저장소</b>(${esc(DEFAULT_REPO.repo)})에 저장해요. 무료이고 결제수단도 필요 없어요. 처음 한 번만 하면 돼요.
      <ol>
        <li><a href="${TOKEN_URL}" target="_blank" rel="noopener"><b>토큰 만들기 페이지 열기 ↗</b></a> (이름·권한·만료 없음은 미리 채워져 있어요)</li>
        <li><b>Repository access</b>에서 <b>Only select repositories</b> → <b>${esc(DEFAULT_REPO.repo)}</b> 선택</li>
        <li>맨 아래 <b>Generate token</b> → 나온 <b>github_pat_…</b> 복사</li>
        <li>아래 칸에 붙여넣고 <b>연결하기</b></li>
      </ol></div>
    <div id="sf-msg"></div>
    <div class="field"><label for="sf-token">토큰</label><input class="input" id="sf-token" type="password" placeholder="github_pat_..." autocomplete="off" spellcheck="false" /></div>
    <details class="more"><summary>고급: 저장소 위치 ▾</summary><div class="row2" style="margin-top:8px"><div class="field"><label for="sf-owner">계정</label><input class="input" id="sf-owner" value="${esc(cur.owner)}" /></div><div class="field"><label for="sf-repo">저장소</label><input class="input" id="sf-repo" value="${esc(cur.repo)}" /></div></div></details>
    <div class="help">배우자 폰은 연결 후 “배우자 폰 연결하기” QR로 한 번에 연결돼요. 토큰은 이 기기에만 저장돼요.</div>`;
  const el = openSheet({ title: '☁️ 함께 쓰기 연결', body, foot: '<button type="button" class="btn btn-primary" id="sf-go">연결하기</button>' });
  const msg = $('#sf-msg', el);
  $('#sf-go', el).addEventListener('click', async () => {
    const token = $('#sf-token', el).value.trim();
    if (!token) { msg.innerHTML = '<div class="err-box">토큰을 붙여넣어 주세요</div>'; return; }
    const c = { owner: $('#sf-owner', el).value.trim() || DEFAULT_REPO.owner, repo: $('#sf-repo', el).value.trim() || DEFAULT_REPO.repo, token };
    const btn = $('#sf-go', el);
    btn.disabled = true; btn.textContent = '확인 중…';
    try {
      await testConnection(c);
      configureSync(c);
      await syncNow({ force: true });
      closeSheet();
      toast('☁️ 연결 완료! 이제 실시간으로 함께 써요');
      onDone?.();
    } catch (e) {
      msg.innerHTML = `<div class="err-box">${esc(e.message || e)}</div>`;
      btn.disabled = false; btn.textContent = '연결하기';
    }
  });
}

export function pairLink() {
  const c = syncConfig();
  if (!c) return '';
  const mine = getDevice().me;
  const payload = b64url(JSON.stringify({ o: c.owner, r: c.repo, t: c.token, me: mine === 'husband' ? 'wife' : mine === 'wife' ? 'husband' : '' }));
  return location.origin + location.pathname + '#pair=' + payload;
}

export function openPairSheet() {
  const link = pairLink();
  if (!link) { openSyncSheet(); return; }
  let svg = '';
  try {
    const qr = window.qrcode(0, 'L');
    qr.addData(link);
    qr.make();
    svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (e) { console.warn(e); }
  const body = `<div style="text-align:center">
    <p class="small ink2" style="margin:0 0 6px">배우자 폰 카메라로 QR을 찍거나, 링크를 카톡으로 보내서 열면<br><b>바로 같은 가계부에 연결</b>돼요.</p>
    ${svg ? `<div class="qr-box">${svg}</div>` : ''}
    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button type="button" class="btn" id="pf-copy">${ICON.copy} 링크 복사</button>${navigator.share ? `<button type="button" class="btn" id="pf-share">${ICON.share} 공유하기</button>` : ''}</div>
    <div class="err-box" style="margin-top:14px;text-align:left">🔐 이 링크는 가계부 열쇠예요. 둘만 있는 대화방에만 보내고, 연결 후엔 메시지를 지워도 좋아요.</div></div>`;
  const el = openSheet({ title: '📱 배우자 폰 연결', body });
  $('#pf-copy', el).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); toast('✓ 링크를 복사했어요'); } catch { prompt('아래 링크를 복사하세요', link); }
  });
  $('#pf-share', el)?.addEventListener('click', () => navigator.share({ title: "두덩's 가계부 연결", text: '우리 가계부 연결 링크 🐻💕', url: link }).catch(() => {}));
}

export async function openHistorySheet() {
  const el = openSheet({ title: '🕘 변경 기록', body: '<div id="hs" class="small muted">불러오는 중…</div>' });
  try {
    const list = await history(40);
    $('#hs', el).innerHTML = list.length ? `<div class="set-list">${list.map((c) => `<div class="set-row" style="min-height:auto;padding:10px 2px"><div class="lbl"><b style="font-weight:600;font-size:14px">${esc(c.message.split('\n')[0])}</b><span>${new Date(c.date).toLocaleString('ko-KR')}</span></div></div>`).join('')}</div>
      <p class="help">모든 변경은 GitHub 저장소에 자동 백업돼요. 실수로 지운 내역도 이 기록에서 찾을 수 있어요.</p>` : '기록이 없어요';
  } catch (e) {
    $('#hs', el).innerHTML = `<div class="err-box">${esc(e.message)}</div>`;
  }
}

export async function confirmDisconnect() {
  if (!(await confirmSheet({ title: '동기화 연결 해제', message: '이 기기에서만 연결이 끊기고, 지금까지의 데이터는 이 기기와 저장소에 그대로 남아요.', ok: '해제' }))) return;
  disconnectSync();
  toast('연결을 해제했어요');
}

// ===== 내보내기 / 가져오기 =====
export function exportJson() {
  download(`두덩가계부_백업_${today()}.json`, serialize(getState()));
  toast('✓ 백업 파일을 저장했어요');
}

export function exportCsv() {
  const rows = [['날짜', '구분', '카테고리', '내용', '금액', '결제수단', '사람', '입력한 사람']];
  const list = all('tx').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  for (const t of list) {
    const ty = typeKey(t.type);
    rows.push([t.date, ty === 'income' ? '수입' : '지출', cat(ty, t.cat).name, t.memo || '', t.amount, PAYS.find((p) => p.key === t.pay)?.name || '', person(t.person).name, t.by ? person(t.by).name : '']);
  }
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(`두덩가계부_내역_${today()}.csv`, csv, 'text/csv;charset=utf-8');
  toast(`✓ ${list.length}건을 엑셀 파일로 저장했어요`);
}

// 예전(v1/v2) 가계부 데이터 → 새 형식
export function convertLegacy(d) {
  const s = emptyState();
  const now = Date.now();
  const payMap = { 카드: 'card', 현금: 'cash', 이체: 'bank', 간편결제: 'pay' };
  const validExp = new Set(EXPENSE_CATS.map((c) => c.key));
  const validInc = new Set(INCOME_CATS.map((c) => c.key));
  const base = (x) => ({ createdAt: now, updatedAt: now, by: '', person: x.person || 'both' });
  for (const e of d.expenses || []) {
    const id = 'v2e_' + e.id;
    s.tx[id] = { ...base(e), id, type: 'expense', amount: Number(e.amount) || 0, date: e.date, memo: e.memo || '', cat: validExp.has(e.cat) ? e.cat : 'etc', pay: payMap[e.pay] || '' };
  }
  for (const e of d.incomes || []) {
    const id = 'v2n_' + e.id;
    s.tx[id] = { ...base(e), id, type: 'income', amount: Number(e.amount) || 0, date: e.date, memo: e.memo || '', cat: validInc.has(e.cat) ? e.cat : 'etc' };
  }
  for (const i of d.investments || []) {
    const id = 'v2i_' + i.id;
    if (i.ticker) {
      const symbol = normalizeSymbol(i.ticker);
      s.invest[id] = { ...base(i), id, type: symbol.startsWith('CR:') ? 'crypto' : 'stock', name: i.name || i.ticker, symbol, qty: Number(i.qty) || 0, avg: Number(i.buy) || 0, currency: i.currency || 'KRW' };
    } else {
      const q = Number(i.qty) || 1;
      const typeMap = { saving: 'saving', real: 'real' };
      s.invest[id] = { ...base(i), id, type: typeMap[i.type] || 'etc', name: i.name || '자산', amount: (Number(i.now) || Number(i.buy) || 0) * q, principal: (Number(i.buy) || 0) * q };
    }
  }
  for (const l of d.loans || []) {
    const id = 'v2l_' + l.id;
    const t = LOAN_TYPES.some((x) => x.key === l.type) ? l.type : 'etc';
    s.loans[id] = { ...base(l), id, type: t, name: l.name || '', principal: Number(l.principal) || 0, remaining: Number(l.remaining ?? l.principal) || 0, rate: Number(l.rate) || 0, monthly: Number(l.monthly) || 0, start: l.start || '', end: l.end || '' };
  }
  for (const [k, v] of Object.entries(d.budgets || {})) if (validExp.has(k) && Number(v)) s.kv['budget.cat.' + k] = { v: Number(v), t: now };
  return s;
}

export function importFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast('JSON 파일을 읽을 수 없어요'); return; }
    const legacy = Array.isArray(data.expenses) || Array.isArray(data.incomes);
    const incoming = legacy ? convertLegacy(data) : normalize(data);
    const count = Object.keys(incoming.tx).length;
    const extra = Object.keys(incoming.invest).length + Object.keys(incoming.loans).length;
    if (!count && !extra && !Object.keys(incoming.kv).length) { toast('가져올 데이터가 없어요'); return; }
    const ok = await confirmSheet({
      title: legacy ? '예전 가계부 가져오기' : '백업 가져오기',
      message: `내역 ${count}건${extra ? `, 자산·대출 ${extra}건` : ''}을 지금 가계부에 <b>합쳐서</b> 넣을게요. 같은 기록은 중복되지 않아요.`,
      ok: '가져오기',
    });
    if (!ok) return;
    replaceAll(merge(getState(), incoming), `가져오기 ${count}건`);
    toast(`✓ ${count}건을 가져왔어요`);
  };
  input.click();
}

export async function resetAll() {
  const ok = await confirmSheet({ title: '전체 초기화', message: '모든 내역·자산·설정을 삭제해요. 동기화 중이면 배우자 기기에서도 사라져요. (GitHub 변경 기록에는 남아 있어요)', ok: '모두 삭제', danger: true });
  if (!ok) return;
  const s = getState();
  batch(() => {
    for (const c of ['tx', 'invest', 'loans', 'recurring', 'goals', 'goalLogs', 'snapshots']) for (const id of Object.keys(s[c])) remove(c, id);
    for (const k of Object.keys(s.kv)) setKV(k, null);
  }, '전체 초기화');
  toast('초기화했어요');
}

// ===== 잠금 비밀번호 설정 =====
export function openPinSetup(onDone) {
  let first = '', cur = '';
  const el = openSheet({
    title: '🔒 잠금 비밀번호',
    body: `<div style="text-align:center"><p class="ink2" id="pn-msg" style="margin:0">새 비밀번호 4자리</p><div class="pin-dots" id="pn-dots"><i></i><i></i><i></i><i></i></div>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button type="button" data-k="${d}">${d}</button>`).join('')}<span></span><button type="button" data-k="0">0</button><button type="button" class="ghost" data-k="del">지우기</button></div></div>`,
    onClose: () => onDone?.(Boolean(loadJSON('dudang3.pin'))),
  });
  const dots = () => $$('#pn-dots i', el).forEach((d, i) => d.classList.toggle('on', i < cur.length));
  el.querySelector('.keypad').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    if (b.dataset.k === 'del') cur = cur.slice(0, -1);
    else if (cur.length < 4) cur += b.dataset.k;
    dots();
    if (cur.length < 4) return;
    if (!first) { first = cur; cur = ''; $('#pn-msg', el).textContent = '한 번 더 입력해 주세요'; setTimeout(dots, 150); return; }
    if (cur !== first) { first = ''; cur = ''; $('#pn-msg', el).textContent = '서로 달라요. 새 비밀번호 4자리'; $('#pn-dots', el).classList.add('shake'); setTimeout(() => { $('#pn-dots', el).classList.remove('shake'); dots(); }, 400); return; }
    const salt = getDevice().id;
    saveJSON('dudang3.pin', { h: await sha256(salt + ':' + cur) });
    toast('🔒 잠금을 설정했어요');
    closeSheet();
  });
}
