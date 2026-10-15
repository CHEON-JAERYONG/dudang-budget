// 화면 렌더링 — 홈 / 내역 / 통계 / 자산 / 설정
import { all, kv, exists, syncStatus, getDevice } from './store.js?v=2.1.4';
import { APP_VERSION, REFRESH_OPTIONS } from './config.js?v=2.1.4';
import {
  ui, names, person, me, PERSON_COLOR, catList, cat, pay, assetType, loanType, txMonth, txYear, totals, sumBy, expensesOf,
  monthsBack, sortTx, budgetTotal, budgetCat, monthProgress, recTxId, ruleDate, holdingValue, netWorth, goalCurrent, dday,
  greeting, refreshSec, mkChart, chartOptions, barStyle, cssVar, isDesktop,
} from './core.js?v=2.1.4';
import { getQuote, lastQuoteTime, symbolLabel, marketState, fxInfo, krwPer } from './market.js?v=2.1.4';
import {
  esc, num, won, signedWon, compactWon, fmtDec, ym, today, addMonths, daysInMonth, monthLabel, parseYmd, dayLabel, relTime, clock, weekday, loadJSON,
} from './util.js?v=2.1.4';
import { ICON } from './ui.js?v=2.1.4';

const PERSON_ORDER = ['husband', 'both', 'wife'];

// ===== 공통 조각 =====
export function monthSwitch(label = monthLabel(ui.month)) {
  return `<div class="month-switch"><button data-act="month" data-d="-1" aria-label="이전 달">${ICON.left}</button><span class="label">${label}</span><button data-act="month" data-d="1" aria-label="다음 달">${ICON.right}</button></div>`;
}

export function txRow(t, { showDate = false } = {}) {
  const type = t.type === 'income' ? 'income' : 'expense';
  const c = cat(type, t.cat);
  const p = person(t.person);
  const d = parseYmd(t.date);
  const meta = [showDate ? `${d.getMonth() + 1}/${d.getDate()}` : '', c.name, `${p.emoji} ${p.name}`, t.pay ? pay(t.pay)?.name : '', t.recurringId ? '🔁 고정' : '']
    .filter(Boolean).join(' · ');
  return `<button class="tx" data-act="tx" data-id="${esc(t.id)}">
    <span class="emo">${c.emoji}</span>
    <span style="min-width:0"><span class="t1" style="display:block">${esc(t.memo || c.name)}</span><span class="t2" style="display:block">${esc(meta)}</span></span>
    <span class="amt num ${type === 'income' ? 'inc' : ''}">${type === 'income' ? '+' : '−'}${num(t.amount)}원</span>
  </button>`;
}

function emptyBox(emoji, text, btn = '') {
  return `<div class="empty"><div class="e">${emoji}</div><p>${text}</p>${btn}</div>`;
}

// 카테고리 순위 막대
function catRank(list, type, { limit = 99, prevList = null, useBudget = true } = {}) {
  const map = sumBy(list, (x) => x.cat || 'etc');
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '';
  const total = rows.reduce((s, r) => s + r[1], 0) || 1;
  const max = rows[0][1] || 1;
  const prev = prevList ? sumBy(prevList, (x) => x.cat || 'etc') : null;
  return `<div class="rank">${rows.slice(0, limit).map(([k, v]) => {
    const c = cat(type, k);
    const b = useBudget && type === 'expense' ? budgetCat(k) : 0;
    const width = b ? Math.min(100, (v / b) * 100) : (v / max) * 100;
    const cls = b ? (v > b ? 'over' : v > b * 0.8 ? 'warn' : '') : '';
    const sub = b ? `예산 ${compactWon(b)}의 ${Math.round((v / b) * 100)}%` : `${Math.round((v / total) * 100)}%`;
    let delta = '';
    if (prev) {
      const pv = prev.get(k) || 0, d = v - pv;
      const bad = type === 'expense' ? d > 0 : d < 0;
      delta = pv ? `<small class="${d === 0 ? '' : bad ? 'bad-text' : 'good-text'}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${compactWon(Math.abs(d))}</small>` : '<small>새로 생김</small>';
    }
    const open = ui.expandCat === type + ':' + k;
    let split = '';
    if (open) {
      const pm = sumBy(list.filter((x) => (x.cat || 'etc') === k), (x) => x.person || 'both');
      split = `<div class="rank-split">${PERSON_ORDER.filter((p) => pm.get(p)).map((p) => `<span>${person(p).emoji} ${esc(person(p).name)} <b class="num">${won(pm.get(p))}</b></span>`).join('')}</div>`;
    }
    return `<button class="rank-row" data-act="expand-cat" data-k="${type}:${esc(k)}" aria-expanded="${open}">
      <span class="emo">${c.emoji}</span>
      <span style="min-width:0;display:block"><span class="nm"><span>${esc(c.name)}</span><em>${sub}</em></span><span class="bar ${type === 'income' ? 'inc' : ''} ${cls}" style="display:block"><i style="width:${width.toFixed(1)}%"></i></span></span>
      <span class="amt num">${won(v)}${delta}</span>
    </button>${split}`;
  }).join('')}</div>`;
}

function peopleSplit(exps) {
  const pm = sumBy(exps, (x) => x.person || 'both');
  const total = exps.reduce((s, x) => s + (x.amount || 0), 0);
  const seg = PERSON_ORDER.filter((k) => pm.get(k) > 0)
    .map((k) => `<i style="width:${((pm.get(k) / total) * 100).toFixed(2)}%;background:var(${PERSON_COLOR[k]})" title="${esc(person(k).name)} ${won(pm.get(k))}"></i>`).join('');
  return `<div class="stackbar" role="img" aria-label="사람별 지출 비율">${seg || '<i style="width:100%;background:var(--surface-3)"></i>'}</div>
    <div class="people">${PERSON_ORDER.map((k) => {
      const v = pm.get(k) || 0;
      return `<div title="${won(v)}"><div class="who"><i style="background:var(${PERSON_COLOR[k]})"></i>${person(k).emoji} ${esc(person(k).name)}</div><div class="amt num">${won(v)}</div><div class="pc">${total ? Math.round((v / total) * 100) : 0}%</div></div>`;
    }).join('')}</div>`;
}

// ===== 홈 =====
export function homeView() {
  const m = ui.month;
  const list = txMonth(m);
  const t = totals(list);
  const prevT = totals(txMonth(addMonths(m, -1)));
  const exps = expensesOf(list);
  const B = budgetTotal();
  const prog = monthProgress(m);
  const n = names();
  const isCur = m === ym();

  let hero;
  if (B > 0) {
    const left = B - t.exp;
    const frac = Math.min(1, t.exp / B);
    const daily = isCur && left > 0 ? Math.floor(left / Math.max(1, prog.daysLeft)) : 0;
    hero = `<section class="hero">
      <div class="label">${monthLabel(m, false)} ${left >= 0 ? '남은 예산' : '예산 초과'}</div>
      <div class="big num">${won(Math.abs(left))}</div>
      <div class="sub">예산 ${won(B)} 중 ${won(t.exp)} 사용</div>
      <div class="meter" role="img" aria-label="예산 ${Math.round(frac * 100)}% 사용"><i style="width:${(frac * 100).toFixed(1)}%"></i>${isCur ? `<b style="left:${(prog.frac * 100).toFixed(1)}%"></b>` : ''}</div>
      <div class="row2"><span>${Math.round((t.exp / B) * 100)}% 사용</span>${isCur ? `<span>│ 오늘까지 적정 ${Math.round(prog.frac * 100)}%</span>` : ''}</div>
      ${isCur ? (left > 0 ? `<div class="daily">☀️ 남은 ${prog.daysLeft}일, 하루 ${won(daily)}씩 쓸 수 있어요</div>` : `<div class="daily">🚨 이번 달 예산을 넘었어요</div>`) : ''}
    </section>`;
  } else {
    hero = `<section class="hero">
      <div class="label">${monthLabel(m, false)} 지출</div>
      <div class="big num">${won(t.exp)}</div>
      <div class="sub">수입 ${won(t.inc)} · 남은 돈 ${signedWon(t.net)}</div>
      <button class="daily" data-act="budget">🎯 예산을 정하면 하루 쓸 돈을 알려줘요 →</button>
    </section>`;
  }

  const expDelta = t.exp - prevT.exp;
  const kpis = `<div class="kpis four">
    <div class="kpi"><div class="k"><i style="background:var(--income)"></i>수입</div><div class="v num">${won(t.inc)}</div><div class="d muted">${prevT.inc ? '지난달 ' + compactWon(prevT.inc) : '&nbsp;'}</div></div>
    <div class="kpi"><div class="k"><i style="background:var(--expense)"></i>지출</div><div class="v num">${won(t.exp)}</div><div class="d ${expDelta > 0 ? 'bad-text' : 'good-text'}">${prevT.exp ? `${expDelta > 0 ? '▲' : '▼'} 지난달보다 ${compactWon(Math.abs(expDelta))}` : '&nbsp;'}</div></div>
    <div class="kpi"><div class="k">남은 돈</div><div class="v num">${signedWon(t.net)}</div><div class="d muted">수입 − 지출</div></div>
    <div class="kpi"><div class="k">저축률</div><div class="v num">${t.rate === null ? '-' : Math.round(t.rate) + '%'}</div><div class="d muted">수입 대비</div></div>
  </div>`;

  // 카드값
  const cards = exps.filter((x) => x.cat === 'card');
  const cardSum = (p) => cards.filter((x) => (x.person || 'both') === p);
  const cardBox = (p) => {
    const l = cardSum(p);
    return `<button data-act="add" data-preset="card-${p}" style="text-align:left"><div class="who">${person(p).emoji} ${esc(n[p])}</div><div class="amt num">${won(l.reduce((s, x) => s + x.amount, 0))}</div><div class="tiny muted">${l.length ? l.length + '건 입력됨' : '눌러서 입력'}</div></button>`;
  };
  const both = cardSum('both').reduce((s, x) => s + x.amount, 0);
  const cardHtml = `<section class="card"><div class="card-h"><h3>💳 ${monthLabel(m, false)} 카드값</h3><span class="tiny muted">합계 ${won(cards.reduce((s, x) => s + x.amount, 0))}</span></div>
    <div class="cardbill">${cardBox('husband')}${cardBox('wife')}</div>
    ${both ? `<div class="tiny muted" style="margin-top:8px">👫 공동 카드 ${won(both)}</div>` : ''}</section>`;

  const peopleHtml = `<section class="card"><div class="card-h"><h3>누가 얼마나 썼을까</h3></div>${exps.length ? peopleSplit(exps) : emptyBox('👫', '아직 지출이 없어요')}</section>`;

  const catHtml = `<section class="card"><div class="card-h"><h3>카테고리별 지출</h3><button class="link" data-go="stats">전체 보기 →</button></div>
    ${exps.length ? catRank(exps, 'expense', { limit: 6 }) : emptyBox('🧾', `${monthLabel(m, false)}에는 아직 지출이 없어요`, '<button class="btn btn-primary btn-sm" data-act="add">+ 첫 지출 입력</button>')}</section>`;

  // 고정지출
  const rules = all('recurring').filter((r) => r.active !== false).sort((a, b) => (a.day || 0) - (b.day || 0));
  let recHtml;
  if (rules.length) {
    const fixedExp = rules.filter((r) => r.type !== 'income').reduce((s, r) => s + (r.amount || 0), 0);
    const td = new Date().getDate();
    recHtml = `<section class="card"><div class="card-h"><h3>🔁 고정 지출·수입</h3><button class="link" data-act="recurring">관리 →</button></div>
      <div class="tiny muted" style="margin:-6px 0 8px">매달 고정지출 ${won(fixedExp)} · 그날 자동 입력</div>
      ${rules.slice(0, 6).map((r) => {
        const done = exists('tx', recTxId(r.id, m));
        const future = r.start && r.start > m;
        const c = cat(r.type === 'income' ? 'income' : 'expense', r.cat);
        const st = future ? `<span class="badge">${Number(r.start.slice(5))}월부터</span>` : done ? '<span class="badge good">✓ 입력됨</span>' : isCur ? `<span class="badge ${r.day - td <= 3 ? 'warn' : ''}">${r.day > td ? 'D-' + (Math.min(r.day, daysInMonth(m)) - td) : '오늘'}</span>` : '<span class="badge">예정</span>';
        return `<div class="tx" style="cursor:default"><span class="emo">${c.emoji}</span><span style="min-width:0"><span class="t1" style="display:block">${esc(r.memo || c.name)}</span><span class="t2" style="display:block">매달 ${r.day >= 31 ? '말' : r.day}일 · ${esc(person(r.person).name)}</span></span><span class="amt num ${r.type === 'income' ? 'inc' : ''}">${num(r.amount)}원<small>${st}</small></span></div>`;
      }).join('')}</section>`;
  } else {
    recHtml = `<section class="card"><div class="card-h"><h3>🔁 고정 지출</h3></div><p class="small muted" style="margin:0 0 12px">월세·관리비·통신비·구독·보험처럼 매달 나가는 돈을 등록하면 그날 자동으로 입력돼요.</p><button class="btn btn-sm" data-act="rec-edit">+ 고정지출 등록</button></section>`;
  }

  const recent = sortTx(list.slice()).slice(0, 5);
  const recentHtml = `<section class="card"><div class="card-h"><h3>최근 내역</h3><button class="link" data-go="list">전체 →</button></div>
    ${recent.length ? `<div class="tx-list">${recent.map((x) => txRow(x, { showDate: true })).join('')}</div>` : emptyBox('✍️', '아직 내역이 없어요')}</section>`;

  const trendHtml = `<section class="card"><div class="card-h"><h3>최근 6개월</h3></div><div class="chart-box"><canvas id="ch-trend" role="img" aria-label="최근 6개월 수입과 지출"></canvas></div></section>`;

  const assetsHtml = `<section class="card" id="home-assets">${homeAssetsInner()}</section>`;

  const goals = all('goals');
  const goalsHtml = goals.length ? `<section class="card"><div class="card-h"><h3>🎯 목표 저축</h3><button class="link" data-act="atab-go" data-v="goals">전체 →</button></div>
    ${goals.slice(0, 3).map((g) => { const cur = goalCurrent(g), p = g.target ? Math.min(100, (cur / g.target) * 100) : 0; return `<div class="goal" style="padding:8px 0"><div class="top"><span class="emo" style="font-size:20px">${esc(g.emoji || '🎯')}</span><span class="nm">${esc(g.name)}</span><span class="small num"><b>${Math.round(p)}%</b></span></div><div class="bar"><i style="width:${p}%"></i></div></div>`; }).join('')}</section>` : '';

  const dd = dday();
  const head = `<div class="greet"><div class="hello">🐻 ${greeting()}, ${me() === 'both' ? '우리 둘' : esc(names()[me()]) + '님'}</div>${dd ? `<span class="dday"><span class="heart">💕</span> ${dd}</span>` : ''}</div>
    <div class="page-head">${monthSwitch()}<span class="spacer"></span></div>`;

  let body;
  if (isDesktop()) {
    body = `<div class="cols"><div class="col">${hero}${kpis}${catHtml}${trendHtml}${recentHtml}</div><div class="col">${cardHtml}${peopleHtml}${recHtml}${assetsHtml}${goalsHtml}</div></div>`;
  } else {
    body = `<div class="stack-gap">${hero}${kpis}${cardHtml}${peopleHtml}${catHtml}${recHtml}${recentHtml}${trendHtml}${assetsHtml}${goalsHtml}</div>`;
  }

  return {
    html: head + body,
    mount() {
      const months = monthsBack(m, 6);
      const tt = months.map((mm) => totals(txMonth(mm)));
      mkChart(document.getElementById('ch-trend'), {
        type: 'bar',
        data: {
          labels: months.map((mm) => monthLabel(mm, false)),
          datasets: [
            { label: '수입', data: tt.map((x) => x.inc), ...barStyle(cssVar('--income')) },
            { label: '지출', data: tt.map((x) => x.exp), ...barStyle(cssVar('--expense')) },
          ],
        },
        options: chartOptions(),
      });
    },
  };
}

export function homeAssetsInner() {
  const nw = netWorth();
  const has = all('invest').length || all('loans').length;
  if (!has) return `<div class="card-h"><h3>💰 우리 자산</h3></div><p class="small muted" style="margin:0 0 12px">주식·코인·예적금·전세보증금·대출을 등록하면 순자산과 실시간 평가손익을 보여줘요.</p><button class="btn btn-sm" data-go="assets">자산 등록하러 가기</button>`;
  return `<div class="card-h"><h3>💰 우리 자산</h3><button class="link" data-go="assets">자세히 →</button></div>
    <div class="nw"><span class="muted small">순자산</span><span class="big num" style="font-size:26px">${won(nw.net)}</span></div>
    <div class="nw-split"><div><div class="tiny muted">자산</div><b class="num">${won(nw.assets)}</b></div><div><div class="tiny muted">대출</div><b class="num">${won(nw.debts)}</b></div></div>
    ${nw.marketValue ? `<div class="small" style="margin-top:10px">투자 평가손익 <b class="num ${nw.marketPl >= 0 ? 'up' : 'down'}">${signedWon(nw.marketPl)}</b> · 오늘 <b class="num ${nw.day >= 0 ? 'up' : 'down'}">${signedWon(nw.day)}</b></div>` : ''}`;
}

// ===== 내역 =====
function applyFilters(list) {
  const L = ui.list;
  const q = L.q.trim().toLowerCase();
  return list.filter((t) => {
    if (L.type === 'expense' && t.type === 'income') return false;
    if (L.type === 'income' && t.type !== 'income') return false;
    if (L.person !== 'all' && (t.person || 'both') !== L.person) return false;
    if (L.cat !== 'all') {
      const [ty, k] = L.cat.split(':');
      if ((t.type === 'income' ? 'income' : 'expense') !== ty || t.cat !== k) return false;
    }
    if (q) {
      const c = cat(t.type === 'income' ? 'income' : 'expense', t.cat);
      const hay = [t.memo, c.name, person(t.person).name, String(t.amount), num(t.amount)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function listBody() {
  const L = ui.list;
  const searching = L.q.trim().length > 0;
  const base = searching ? all('tx') : txMonth(ui.month);
  const list = applyFilters(base);
  const t = totals(list);
  const sum = `<div class="sumbar"><div><div class="k">수입</div><div class="v num income-text">${won(t.inc)}</div></div><div><div class="k">지출</div><div class="v num">${won(t.exp)}</div></div><div><div class="k">합계</div><div class="v num">${signedWon(t.net)}</div></div></div>`;
  const note = searching ? `<div class="small muted" style="margin:-4px 2px 10px">전체 기간에서 “${esc(L.q)}” 검색 결과 ${list.length}건</div>` : '';
  if (L.mode === 'cal' && !searching) return sum + calendar(list);
  if (!list.length) return sum + note + `<section class="card">${emptyBox('🔍', searching || L.type !== 'all' || L.person !== 'all' || L.cat !== 'all' ? '조건에 맞는 내역이 없어요' : `${monthLabel(ui.month, false)} 내역이 없어요`, '<button class="btn btn-primary btn-sm" data-act="add">+ 입력하기</button>')}</section>`;
  return sum + note + `<section class="card tx-card">${grouped(list, searching)}</section>`;
}

function grouped(list, showYear = false) {
  sortTx(list);
  const out = [];
  let cur = null, items = [];
  const flush = () => {
    if (!cur) return;
    const tt = totals(items);
    const y = showYear && !cur.startsWith(String(new Date().getFullYear())) ? cur.slice(0, 4) + '년 ' : '';
    out.push(`<div class="day-head"><span>${y}${dayLabel(cur)}</span><span class="sum num">${tt.exp ? '−' + num(tt.exp) : ''}${tt.exp && tt.inc ? ' · ' : ''}${tt.inc ? '+' + num(tt.inc) : ''}</span></div>${items.map((x) => txRow(x)).join('')}`);
  };
  for (const t of list) {
    if (t.date !== cur) { flush(); cur = t.date; items = []; }
    items.push(t);
  }
  flush();
  return `<div class="tx-list">${out.join('')}</div>`;
}

// 달력 칸: PC는 정확한 금액, 휴대폰은 칸이 작아 만원 단위
const calAmt = (v) => (isDesktop() ? num(v) : compactWon(v));

function calendar(list) {
  const m = ui.month;
  const first = parseYmd(m + '-01').getDay();
  const dim = daysInMonth(m);
  const by = {};
  for (const t of list) {
    const b = (by[t.date] ||= { e: 0, i: 0 });
    if (t.type === 'income') b.i += t.amount; else b.e += t.amount;
  }
  const maxE = Math.max(1, ...Object.values(by).map((b) => b.e));
  const td = today();
  if (!ui.calSel || !ui.calSel.startsWith(m)) ui.calSel = td.startsWith(m) ? td : null;
  let cells = ['일', '월', '화', '수', '목', '금', '토'].map((w, i) => `<div class="wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('');
  for (let i = 0; i < first; i++) cells += '<div class="d blank"></div>';
  for (let d = 1; d <= dim; d++) {
    const ds = `${m}-${String(d).padStart(2, '0')}`;
    const b = by[ds];
    const heat = b?.e ? `background:rgba(var(--heat),${(0.1 + 0.34 * (b.e / maxE)).toFixed(3)})` : '';
    cells += `<button class="d ${ds === td ? 'today' : ''} ${ds === ui.calSel ? 'sel' : ''}" style="${heat}" data-act="cal-day" data-d="${ds}" aria-label="${d}일${b ? ` 지출 ${won(b.e)} 수입 ${won(b.i)}` : ''}"><span class="n">${d}</span>${b?.e ? `<span class="e num">${calAmt(b.e)}</span>` : ''}${b?.i ? `<span class="i num">${calAmt(b.i)}</span>` : ''}</button>`;
  }
  let dayList = '';
  if (ui.calSel) {
    const items = list.filter((t) => t.date === ui.calSel);
    dayList = `<section class="card tx-card" style="margin-top:12px"><div class="day-head"><span>${dayLabel(ui.calSel)}</span><button class="btn btn-sm" data-act="add" data-date="${ui.calSel}">+ 이 날 입력</button></div>
      ${items.length ? `<div class="tx-list">${sortTx(items).map((x) => txRow(x)).join('')}</div>` : '<div class="small muted" style="padding:8px 6px 4px">내역 없음</div>'}</section>`;
  }
  return `<section class="card"><div class="cal">${cells}</div></section>${dayList}`;
}

export function listView() {
  const L = ui.list;
  const catOpts = (type, label) => `<optgroup label="${label}">${catList(type, { includeHidden: true }).map((c) => `<option value="${type}:${c.key}" ${L.cat === type + ':' + c.key ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}</optgroup>`;
  const chip = (k, v, label) => `<button class="chip ${L[k] === v ? 'on' : ''}" data-act="lf" data-k="${k}" data-v="${v}">${label}</button>`;
  const html = `<div class="page-head">${monthSwitch()}<div class="seg"><button class="${L.mode === 'list' ? 'on' : ''}" data-act="list-mode" data-v="list">목록</button><button class="${L.mode === 'cal' ? 'on' : ''}" data-act="list-mode" data-v="cal">달력</button></div><span class="spacer"></span>${isDesktop() ? '<button class="btn btn-primary" data-act="add">' + ICON.plus + ' 입력</button>' : ''}</div>
    <div class="filters">
      <div class="row"><label class="searchbox">${ICON.search}<input id="list-q" type="search" placeholder="내용·금액·카테고리 검색 (전체 기간)" value="${esc(L.q)}" autocomplete="off" /></label>
      <select class="input" id="list-cat" style="width:auto;min-width:150px;height:44px"><option value="all">모든 카테고리</option>${catOpts('expense', '지출')}${catOpts('income', '수입')}</select></div>
      <div class="chips">${chip('type', 'all', '전체')}${chip('type', 'expense', '지출')}${chip('type', 'income', '수입')}<span style="width:8px;flex:none"></span>${chip('person', 'all', '모두')}${['husband', 'wife', 'both'].map((p) => chip('person', p, person(p).emoji + ' ' + esc(person(p).name))).join('')}</div>
    </div>
    <div id="list-body">${listBody()}</div>`;
  return { html };
}

// ===== 통계 =====
export function statsView() {
  const isYear = ui.statsMode === 'year';
  const y = ui.statsYear;
  const m = ui.month;
  const list = isYear ? txYear(y) : txMonth(m);
  const prev = isYear ? txYear(y - 1) : txMonth(addMonths(m, -1));
  const t = totals(list), pt = totals(prev);
  const exps = expensesOf(list), incs = list.filter((x) => x.type === 'income');
  const switcher = isYear
    ? `<div class="month-switch"><button data-act="year" data-d="-1" aria-label="이전 해">${ICON.left}</button><span class="label">${y}년</span><button data-act="year" data-d="1" aria-label="다음 해">${ICON.right}</button></div>`
    : monthSwitch();
  const prevLabel = isYear ? '작년' : '지난달';
  const d = t.exp - pt.exp;
  const kpis = `<div class="kpis four">
    <div class="kpi"><div class="k"><i style="background:var(--expense)"></i>지출</div><div class="v num">${won(t.exp)}</div><div class="d ${d > 0 ? 'bad-text' : 'good-text'}">${pt.exp ? `${d > 0 ? '▲' : '▼'} ${prevLabel}보다 ${compactWon(Math.abs(d))}` : '&nbsp;'}</div></div>
    <div class="kpi"><div class="k"><i style="background:var(--income)"></i>수입</div><div class="v num">${won(t.inc)}</div><div class="d muted">${pt.inc ? prevLabel + ' ' + compactWon(pt.inc) : '&nbsp;'}</div></div>
    <div class="kpi"><div class="k">저축액</div><div class="v num">${signedWon(t.net)}</div><div class="d muted">수입 − 지출</div></div>
    <div class="kpi"><div class="k">저축률</div><div class="v num">${t.rate === null ? '-' : Math.round(t.rate) + '%'}</div><div class="d muted">${pt.rate === null ? '&nbsp;' : prevLabel + ' ' + Math.round(pt.rate) + '%'}</div></div>
  </div>`;

  const months = isYear ? Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`) : monthsBack(m, 6);
  const mt = months.map((mm) => ({ m: mm, ...totals(txMonth(mm)) }));
  const trendTable = `<details class="more"><summary>표로 보기 ▾</summary><div class="tbl-wrap"><table class="tbl num"><thead><tr><th>월</th><th>수입</th><th>지출</th><th>저축</th><th>저축률</th></tr></thead><tbody>${mt.map((r) => `<tr><td>${monthLabel(r.m, false)}</td><td>${num(r.inc)}</td><td>${num(r.exp)}</td><td>${num(r.net)}</td><td>${r.rate === null ? '-' : Math.round(r.rate) + '%'}</td></tr>`).join('')}</tbody></table></div></details>`;

  // 카드값 월별
  const cardRows = months.map((mm) => {
    const cl = txMonth(mm).filter((x) => x.type !== 'income' && x.cat === 'card');
    const s = (p) => cl.filter((x) => (x.person || 'both') === p).reduce((a, x) => a + x.amount, 0);
    return { m: mm, h: s('husband'), w: s('wife'), b: s('both') };
  });
  const hasCard = cardRows.some((r) => r.h || r.w || r.b);
  const n = names();
  const cardHtml = `<section class="card"><div class="card-h"><h3>💳 카드값 월별</h3></div>${hasCard ? `<div class="tbl-wrap"><table class="tbl num"><thead><tr><th>월</th><th>👨 ${esc(n.husband)}</th><th>👩 ${esc(n.wife)}</th><th>합계</th></tr></thead><tbody>${cardRows.map((r) => `<tr><td>${monthLabel(r.m, false)}</td><td>${num(r.h)}</td><td>${num(r.w)}</td><td><b>${num(r.h + r.w + r.b)}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted" style="margin:0">지출 입력 시 카테고리를 “💳 카드값”으로 고르면 남편·아내 카드값을 따로 모아 보여줘요.</p>'}</section>`;

  const payMap = sumBy(exps, (x) => x.pay || 'none');
  const payTotal = exps.reduce((s, x) => s + x.amount, 0) || 1;
  const payRows = [...payMap.entries()].sort((a, b) => b[1] - a[1]);
  const payHtml = `<section class="card"><div class="card-h"><h3>결제수단</h3></div>${payRows.length ? `<div class="rank">${payRows.map(([k, v]) => { const p = pay(k); return `<div class="rank-row" style="cursor:default"><span class="emo">${p?.emoji || '❔'}</span><span style="display:block;min-width:0"><span class="nm"><span>${p?.name || '미지정'}</span><em>${Math.round((v / payTotal) * 100)}%</em></span><span class="bar" style="display:block"><i style="width:${((v / payRows[0][1]) * 100).toFixed(1)}%"></i></span></span><span class="amt num">${won(v)}</span></div>`; }).join('')}</div>` : emptyBox('💳', '지출이 없어요')}</section>`;

  const places = new Map();
  for (const x of exps) {
    const k = (x.memo || '').trim();
    if (!k) continue;
    const p = places.get(k) || { n: 0, s: 0 };
    p.n++; p.s += x.amount;
    places.set(k, p);
  }
  const top = [...places.entries()].sort((a, b) => b[1].n - a[1].n || b[1].s - a[1].s).slice(0, 8);
  const placesHtml = `<section class="card"><div class="card-h"><h3>자주 쓴 곳</h3></div>${top.length ? `<div class="tbl-wrap"><table class="tbl num"><thead><tr><th>내용</th><th>횟수</th><th>합계</th></tr></thead><tbody>${top.map(([k, v]) => `<tr><td style="white-space:normal">${esc(k)}</td><td>${v.n}회</td><td>${num(v.s)}</td></tr>`).join('')}</tbody></table></div>` : emptyBox('📍', '메모를 입력하면 자주 쓰는 곳을 알려줘요')}</section>`;

  const catHtml = `<section class="card"><div class="card-h"><h3>카테고리별 지출</h3><span class="tiny muted">${prevLabel} 대비</span></div>${exps.length ? catRank(exps, 'expense', { prevList: expensesOf(prev) }) : emptyBox('🧾', '지출이 없어요')}</section>`;
  const incHtml = incs.length ? `<section class="card"><div class="card-h"><h3>수입 구성</h3></div>${catRank(incs, 'income', { useBudget: false })}</section>` : '';
  const trendHtml = `<section class="card"><div class="card-h"><h3>${isYear ? y + '년 월별' : '최근 6개월'} 수입·지출</h3></div><div class="chart-box tall"><canvas id="ch-st-trend" role="img" aria-label="월별 수입과 지출"></canvas></div>${trendTable}</section>`;
  const peopleHtml = `<section class="card"><div class="card-h"><h3>사람별 지출</h3></div>${exps.length ? peopleSplit(exps) : ''}<div class="chart-box" style="margin-top:14px"><canvas id="ch-st-people" role="img" aria-label="월별 사람별 지출"></canvas></div></section>`;
  const wdHtml = `<section class="card"><div class="card-h"><h3>요일별 지출</h3></div><div class="chart-box"><canvas id="ch-st-wd" role="img" aria-label="요일별 지출 합계"></canvas></div></section>`;

  const head = `<div class="page-head"><div class="seg"><button class="${!isYear ? 'on' : ''}" data-act="stats-mode" data-v="month">월간</button><button class="${isYear ? 'on' : ''}" data-act="stats-mode" data-v="year">연간</button></div>${switcher}</div>`;
  const body = isDesktop()
    ? `${kpis}<div class="cols even" style="margin-top:16px"><div class="col">${catHtml}${incHtml}${payHtml}${placesHtml}</div><div class="col">${trendHtml}${peopleHtml}${cardHtml}${wdHtml}</div></div>`
    : `<div class="stack-gap">${kpis}${catHtml}${trendHtml}${cardHtml}${peopleHtml}${payHtml}${wdHtml}${placesHtml}${incHtml}</div>`;

  return {
    html: head + body,
    mount() {
      mkChart(document.getElementById('ch-st-trend'), {
        type: 'bar',
        data: { labels: mt.map((r) => monthLabel(r.m, false)), datasets: [{ label: '수입', data: mt.map((r) => r.inc), ...barStyle(cssVar('--income')) }, { label: '지출', data: mt.map((r) => r.exp), ...barStyle(cssVar('--expense')) }] },
        options: chartOptions(),
      });
      const surface = cssVar('--surface');
      const pdata = (p) => months.map((mm) => expensesOf(txMonth(mm)).filter((x) => (x.person || 'both') === p).reduce((s, x) => s + x.amount, 0));
      mkChart(document.getElementById('ch-st-people'), {
        type: 'bar',
        data: {
          labels: months.map((mm) => monthLabel(mm, false)),
          datasets: PERSON_ORDER.map((p, i) => ({
            label: `${person(p).emoji} ${person(p).name}`, data: pdata(p), backgroundColor: cssVar(PERSON_COLOR[p]),
            borderColor: surface, borderWidth: { top: i === PERSON_ORDER.length - 1 ? 0 : 2, bottom: 0, left: 0, right: 0 },
            borderRadius: i === PERSON_ORDER.length - 1 ? { topLeft: 4, topRight: 4 } : 0, borderSkipped: false, maxBarThickness: 24, categoryPercentage: 0.6,
          })),
        },
        options: chartOptions({ stacked: true }),
      });
      const wd = [0, 0, 0, 0, 0, 0, 0];
      for (const x of exps) wd[parseYmd(x.date).getDay()] += x.amount;
      const order = [1, 2, 3, 4, 5, 6, 0];
      mkChart(document.getElementById('ch-st-wd'), {
        type: 'bar',
        data: { labels: order.map((i) => ['일', '월', '화', '수', '목', '금', '토'][i]), datasets: [{ label: '지출', data: order.map((i) => wd[i]), ...barStyle(cssVar('--expense')) }] },
        options: chartOptions({ legend: false }),
      });
    },
  };
}

// ===== 자산 =====
function quoteStatus() {
  const hs = all('invest').filter((h) => assetType(h.type).market && h.symbol);
  if (!hs.length) return '';
  const lq = lastQuoteTime();
  const sec = refreshSec();
  const anyOpen = hs.some((h) => { const q = getQuote(h.symbol); return q && (q.market === 'OPEN' || q.exchange === '업비트'); });
  const badge = ui.quoteBusy ? '<span class="badge warn">갱신 중…</span>'
    : ui.quoteErr ? '<span class="badge bad">시세 연결 실패</span>'
      : anyOpen ? '<span class="badge good"><i class="live-dot"></i>실시간</span>' : '<span class="badge">장 마감</span>';
  const every = sec ? (sec >= 60 ? sec / 60 + '분' : sec + '초') + '마다 자동 갱신' : '자동 갱신 꺼짐';
  return `<div id="quote-status" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">${badge}<span class="small muted">${lq ? clock(lq) + ' 기준' : '시세 불러오는 중'} · ${every}</span><span class="spacer" style="flex:1"></span><button class="icon-btn" data-act="refresh-quotes" aria-label="시세 새로고침">${ICON.refresh}</button></div>`;
}

function holdRow(h) {
  const v = holdingValue(h);
  const t = assetType(h.type);
  const p = person(h.person);
  let meta, priceLine = '';
  if (t.market) {
    const q = v.quote;
    const unitName = h.type === 'crypto' ? '개' : '주';
    const avg = v.foreign ? '$' + fmtDec(h.avg, 4) : won(h.avg);
    meta = `${esc(symbolLabel(h.symbol))}${q?.exchange ? ' · ' + esc(q.exchange) : ''} · ${fmtDec(h.qty, 8)}${unitName} · 평단 ${avg}`;
    if (q && !h.manualPrice) {
      const ms = marketState(q);
      priceLine = `현재가 <b class="num">${won(v.unitKRW)}</b>${v.foreign ? ` <span class="muted num">($${fmtDec(q.price, 4)})</span>` : ''} <span class="num ${q.change >= 0 ? 'up' : 'down'}">${q.change >= 0 ? '▲' : '▼'}${Math.abs(q.pct).toFixed(2)}%</span> <span class="badge ${ms.tone}" style="margin-left:2px">${ms.label}</span>`;
    } else if (h.manualPrice) priceLine = `직접 입력한 현재가 <b class="num">${won(v.unitKRW)}</b>`;
    else priceLine = '<span class="muted">시세 불러오는 중…</span>';
  } else {
    meta = `${t.name}${h.note ? ' · ' + esc(h.note) : ''}`;
  }
  const plHtml = v.cost ? `<span class="${v.pl >= 0 ? 'up' : 'down'} num">${signedWon(v.pl)} (${v.plPct >= 0 ? '+' : ''}${v.plPct.toFixed(2)}%)</span>` : '';
  return `<button class="hold" data-act="invest" data-id="${esc(h.id)}">
    <span style="min-width:0"><span class="nm"><span>${t.emoji} ${esc(h.name || symbolLabel(h.symbol))}</span><span class="badge">${p.emoji} ${esc(p.name)}</span></span><span class="meta" style="display:block">${meta}</span></span>
    <span class="right"><span class="val num">${won(v.value)}</span><span class="pl">${plHtml}</span></span>
    ${priceLine ? `<span class="price" style="grid-column:1/-1;min-width:0">${priceLine}</span>` : ''}
  </button>`;
}

export function investInner() {
  const hs = all('invest').sort((a, b) => holdingValue(b).value - holdingValue(a).value);
  const nw = netWorth();
  const market = hs.filter((h) => assetType(h.type).market);
  const other = hs.filter((h) => !assetType(h.type).market);
  const fx = fxInfo();
  const sumHtml = market.length ? `<div class="kpis four" style="margin-bottom:12px">
      <div class="kpi"><div class="k">투자 평가금액</div><div class="v num">${won(nw.marketValue)}</div></div>
      <div class="kpi"><div class="k">투자 원금</div><div class="v num">${won(nw.marketCost)}</div></div>
      <div class="kpi"><div class="k">평가손익</div><div class="v num ${nw.marketPl >= 0 ? 'up' : 'down'}">${signedWon(nw.marketPl)}</div><div class="d muted">${nw.marketCost ? ((nw.marketPl / nw.marketCost) * 100).toFixed(2) + '%' : ''}</div></div>
      <div class="kpi"><div class="k">오늘 변동</div><div class="v num ${nw.day >= 0 ? 'up' : 'down'}">${signedWon(nw.day)}</div></div>
    </div>` : '';
  return `${sumHtml}
    <section class="card"><div class="card-h"><h3>📊 주식·코인</h3><button class="btn btn-sm btn-primary" data-act="invest-new" data-kind="market">+ 종목 추가</button></div>
      ${quoteStatus()}
      ${market.length ? market.map(holdRow).join('') : emptyBox('📈', '삼성전자, 애플, 비트코인처럼 검색해서 추가하면<br>실시간 시세로 원화 평가금액을 계산해요')}
      ${market.some((h) => holdingValue(h).foreign) ? `<div class="tiny muted" style="margin-top:8px">해외주식은 원화로 환산해 보여줘요 · 환율 1달러 = ${fmtDec(krwPer('USD'), 2)}원${fx.updated ? ` (${esc(fx.source || '')} ${new Date(fx.updated).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })})` : ''}</div>` : ''}
    </section>
    <section class="card"><div class="card-h"><h3>🏦 예적금·현금·보증금</h3><button class="btn btn-sm" data-act="invest-new" data-kind="other">+ 추가</button></div>
      ${other.length ? other.map(holdRow).join('') : emptyBox('🐷', '예적금, 통장 잔액, 전세보증금 등을 등록해 보세요')}
    </section>`;
}

function loansInner() {
  const ls = all('loans').sort((a, b) => (b.remaining || 0) - (a.remaining || 0));
  const totalRem = ls.reduce((s, l) => s + (l.remaining || 0), 0);
  const monthly = ls.reduce((s, l) => s + (l.monthly || 0), 0);
  const interest = ls.reduce((s, l) => s + ((l.remaining || 0) * (l.rate || 0)) / 100 / 12, 0);
  return `<div class="kpis" style="margin-bottom:12px"><div class="kpi"><div class="k">대출 잔액</div><div class="v num">${won(totalRem)}</div></div><div class="kpi"><div class="k">월 이자(추정)</div><div class="v num">${won(interest)}</div><div class="d muted">월 상환 ${won(monthly)}</div></div></div>
    <section class="card"><div class="card-h"><h3>🏦 대출</h3><button class="btn btn-sm btn-primary" data-act="loan-new">+ 대출 추가</button></div>
    ${ls.length ? ls.map((l) => {
      const t = loanType(l.type);
      const paid = l.principal ? Math.max(0, Math.min(100, ((l.principal - l.remaining) / l.principal) * 100)) : 0;
      const mi = ((l.remaining || 0) * (l.rate || 0)) / 100 / 12;
      let end = '';
      if (l.end) { const dd = Math.round((parseYmd(l.end) - parseYmd(today())) / 864e5); end = dd >= 0 ? `만기 D-${dd}` : '만기 지남'; }
      return `<button class="hold" data-act="loan" data-id="${esc(l.id)}" style="grid-template-columns:1fr auto">
        <span style="min-width:0"><span class="nm"><span>${t.emoji} ${esc(l.name || t.name)}</span><span class="badge">${person(l.person).emoji} ${esc(person(l.person).name)}</span></span><span class="meta" style="display:block">${t.name} · 연 ${fmtDec(l.rate || 0, 2)}% · 월 이자 약 ${won(mi)}${end ? ' · ' + end : ''}</span></span>
        <span class="val num">${won(l.remaining)}</span>
        <span style="grid-column:1/-1;display:block" class="loan-prog"><span class="bar inc" style="display:block"><i style="width:${paid.toFixed(1)}%"></i></span><span class="tiny muted" style="display:flex;justify-content:space-between;margin-top:4px"><span>원금 ${won(l.principal)} 중 ${paid.toFixed(1)}% 상환</span>${l.monthly ? `<span>월 ${won(l.monthly)}</span>` : ''}</span></span>
      </button>`;
    }).join('') : emptyBox('🔑', '전세대출, 주택담보대출 등을 등록하면<br>잔액과 월 이자를 계산해요')}</section>`;
}

function goalsInner() {
  const gs = all('goals').sort((a, b) => (a.deadline || '9').localeCompare(b.deadline || '9'));
  return `<section class="card"><div class="card-h"><h3>🎯 목표 저축</h3><button class="btn btn-sm btn-primary" data-act="goal-new">+ 목표 추가</button></div>
    ${gs.length ? gs.map((g) => {
      const cur = goalCurrent(g);
      const p = g.target ? Math.min(100, (cur / g.target) * 100) : 0;
      let need = '';
      if (g.deadline && g.target > cur) {
        const [yy, mm] = g.deadline.split('-').map(Number);
        const now = new Date();
        const months = (yy - now.getFullYear()) * 12 + (mm - (now.getMonth() + 1)) + 1;
        need = months > 0 ? `매달 ${won(Math.ceil((g.target - cur) / months))}씩 모으면 달성` : '기한이 지났어요';
      } else if (g.target && cur >= g.target) need = '🎉 목표 달성!';
      return `<div class="goal"><div class="top"><span class="emo">${esc(g.emoji || '🎯')}</span><span class="nm">${esc(g.name)}<span class="tiny muted" style="display:block;font-weight:600">${g.deadline ? g.deadline.replace('-', '년 ') + '월까지 · ' : ''}${need}</span></span><button class="btn btn-sm" data-act="goal-deposit" data-id="${esc(g.id)}">+ 적립</button><button class="icon-btn" data-act="goal" data-id="${esc(g.id)}" aria-label="수정">✏️</button></div>
        <div class="bar" style="height:10px;margin-top:10px"><i style="width:${p.toFixed(1)}%"></i></div>
        <div class="small" style="display:flex;justify-content:space-between;margin-top:6px"><b class="num">${won(cur)}</b><span class="muted num">목표 ${won(g.target)} · ${Math.round(p)}%</span></div></div>`;
    }).join('') : emptyBox('🏡', '내 집 마련, 여행, 비상금처럼<br>함께 모을 목표를 만들어 보세요')}</section>`;
}

export function assetsView() {
  const nw = netWorth();
  const snaps = all('snapshots').sort((a, b) => a.id.localeCompare(b.id));
  const prevSnap = snaps.filter((s) => s.id < ym()).pop();
  const tab = ui.assetsTab;
  const tabBtn = (v, label) => `<button class="${tab === v ? 'on' : ''}" data-act="atab" data-v="${v}">${label}</button>`;
  const nwHtml = `<section class="card"><div class="nw"><span class="muted small">우리 순자산 (자산 − 대출)</span><span class="big num">${won(nw.net)}</span>
      ${prevSnap ? `<span class="small ${nw.net - prevSnap.net >= 0 ? 'good-text' : 'bad-text'}">${nw.net - prevSnap.net >= 0 ? '▲' : '▼'} 지난달 말보다 ${compactWon(Math.abs(nw.net - prevSnap.net))}</span>` : ''}</div>
    <div class="nw-split"><div><div class="tiny muted">자산</div><b class="num">${won(nw.assets)}</b></div><div><div class="tiny muted">대출</div><b class="num">${won(nw.debts)}</b></div></div></section>`;
  const inner = tab === 'loans' ? loansInner() : tab === 'goals' ? goalsInner() : `<div id="invest-inner">${investInner()}</div>`;
  return {
    html: `<div class="page-head"><h1>자산</h1><span class="spacer"></span><div class="seg">${tabBtn('invest', '투자·자산')}${tabBtn('loans', '대출')}${tabBtn('goals', '목표')}</div></div>
      <div class="stack-gap">${nwHtml}${inner}</div>`,
  };
}

// ===== 설정 =====
export function syncCardInner() {
  const st = syncStatus();
  const stateText = { local: '이 기기에만 저장 중', idle: '연결됨', syncing: '동기화 중…', synced: '동기화 완료', offline: '오프라인 (연결되면 자동 업로드)', error: '동기화 오류', auth: '권한 오류' }[st.state] || st.state;
  const head = '<div class="card-h"><h3>☁️ 함께 쓰기 (동기화)</h3></div>';
  return head + (st.configured
    ? `<div class="set-list">
        <div class="set-row"><div class="lbl"><b>☁️ ${stateText}</b><span>${esc(st.repo)} · ${st.lastSync ? relTime(st.lastSync) + ' 동기화' : '아직 동기화 전'}${st.dirty ? ' · 올릴 변경 있음' : ''}</span></div><button class="btn btn-sm" data-act="sync-now">${ICON.refresh} 지금</button></div>
        ${st.error ? `<div class="err-box" style="margin:8px 0 0">${esc(st.error)}</div>` : ''}
        <div class="set-row click" data-act="pair"><div class="lbl"><b>📱 배우자 폰 연결하기</b><span>QR코드나 링크로 같은 가계부를 함께 써요</span></div>${ICON.right}</div>
        <div class="set-row click" data-act="history"><div class="lbl"><b>🕘 변경 기록</b><span>누가 언제 무엇을 바꿨는지 (자동 백업)</span></div>${ICON.right}</div>
        <div class="set-row click" data-act="disconnect"><div class="lbl"><b>연결 해제</b><span>이 기기에서만 동기화를 끕니다 (데이터는 그대로)</span></div>${ICON.right}</div>
      </div>`
    : `<p class="small ink2" style="margin:0 0 12px">지금은 이 기기에만 저장되고 있어요. 동기화를 연결하면 남편·아내 폰과 PC에서 같은 가계부를 실시간으로 함께 써요. (무료 · 비공개 저장소)</p>
       <button class="btn btn-primary" data-act="sync">☁️ 동기화 연결하기</button>`);
}

export function settingsView() {
  const dev = getDevice();
  const n = kv('names', {}) || {};
  const theme = loadJSON('dudang3.theme') || 'auto';
  const pinOn = Boolean(loadJSON('dudang3.pin'));
  const rules = all('recurring').sort((a, b) => (a.day || 0) - (b.day || 0));
  const html = `<div class="page-head"><h1>설정</h1></div>
  <div class="cols even">
  <div class="col">
    <section class="card"><div class="card-h"><h3>👫 우리 정보</h3></div><div class="set-list">
      <div class="set-row"><div class="lbl"><b>이 기기 사용자</b><span>새 내역의 기본 사람으로 쓰여요</span></div><div class="seg"><button class="${dev.me === 'husband' ? 'on' : ''}" data-act="set-me" data-v="husband">👨 남편</button><button class="${dev.me === 'wife' ? 'on' : ''}" data-act="set-me" data-v="wife">👩 아내</button></div></div>
      <div class="set-row"><div class="lbl"><b>남편 이름</b></div><input class="input" id="set-name-h" value="${esc(n.husband || '')}" placeholder="남편" maxlength="10" /></div>
      <div class="set-row"><div class="lbl"><b>아내 이름</b></div><input class="input" id="set-name-w" value="${esc(n.wife || '')}" placeholder="아내" maxlength="10" /></div>
      <div class="set-row"><div class="lbl"><b>결혼기념일</b><span>홈에 “결혼 N일째” 표시</span></div><input class="input" type="date" id="set-wedding" value="${esc(kv('wedding', ''))}" /></div>
    </div></section>
    <section class="card" id="sync-card">${syncCardInner()}</section>
    <section class="card"><div class="card-h"><h3>🎯 예산</h3><button class="btn btn-sm" data-act="budget">설정</button></div>
      <p class="small ink2" style="margin:0">월 예산 <b class="num">${budgetTotal() ? won(budgetTotal()) : '미설정'}</b>${catList('expense').filter((c) => budgetCat(c.key)).length ? ` · 카테고리 예산 ${catList('expense').filter((c) => budgetCat(c.key)).length}개` : ''}</p></section>
    <section class="card"><div class="card-h"><h3>🔁 고정 지출·수입</h3><button class="btn btn-sm btn-primary" data-act="rec-edit">+ 추가</button></div>
      ${rules.length ? rules.map((r) => { const c = cat(r.type === 'income' ? 'income' : 'expense', r.cat); return `<button class="tx" data-act="rec-edit" data-id="${esc(r.id)}"><span class="emo">${c.emoji}</span><span style="min-width:0"><span class="t1" style="display:block">${esc(r.memo || c.name)}${r.active === false ? ' <span class="badge">일시정지</span>' : ''}</span><span class="t2" style="display:block">매달 ${r.day >= 31 ? '말' : r.day}일 · ${esc(person(r.person).name)} · ${c.name}</span></span><span class="amt num ${r.type === 'income' ? 'inc' : ''}">${num(r.amount)}원</span></button>`; }).join('') : '<p class="small muted" style="margin:0">월세, 관리비, 통신비, 보험, 구독, 카드값 자동이체처럼 매달 같은 날 나가는 돈을 등록하면 그날 자동으로 입력돼요.</p>'}
    </section>
  </div>
  <div class="col">
    <section class="card"><div class="card-h"><h3>⚙️ 앱 설정</h3></div><div class="set-list">
      <div class="set-row click" data-act="cats"><div class="lbl"><b>카테고리 관리</b><span>숨기기 · 새 카테고리 만들기</span></div>${ICON.right}</div>
      <div class="set-row"><div class="lbl"><b>시세 갱신 주기</b><span>투자 종목 실시간 시세</span></div><select class="input" id="set-refresh">${REFRESH_OPTIONS.map((o) => `<option value="${o.v}" ${refreshSec() === o.v ? 'selected' : ''}>${o.label}</option>`).join('')}</select></div>
      <div class="set-row"><div class="lbl"><b>화면 테마</b></div><select class="input" id="set-theme"><option value="auto" ${theme === 'auto' ? 'selected' : ''}>기기 설정 따라가기</option><option value="light" ${theme === 'light' ? 'selected' : ''}>밝게</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>어둡게</option></select></div>
      <div class="set-row"><div class="lbl"><b>🔒 잠금 비밀번호</b><span>이 기기에서 열 때 4자리 비밀번호</span></div><label class="toggle"><input type="checkbox" id="set-pin" ${pinOn ? 'checked' : ''} /><span></span></label></div>
    </div></section>
    <section class="card"><div class="card-h"><h3>💾 데이터</h3></div><div class="set-list">
      <div class="set-row click" data-act="export-csv"><div class="lbl"><b>엑셀(CSV)로 내보내기</b><span>전체 내역을 엑셀에서 열 수 있게</span></div>${ICON.right}</div>
      <div class="set-row click" data-act="export-json"><div class="lbl"><b>백업 파일 저장</b><span>모든 데이터를 파일 하나로 (JSON)</span></div>${ICON.right}</div>
      <div class="set-row click" data-act="import"><div class="lbl"><b>백업·예전 가계부 가져오기</b><span>예전 가계부(1.0) 백업도 그대로 불러와요</span></div>${ICON.right}</div>
      <div class="set-row click" data-act="reset"><div class="lbl"><b class="bad-text">전체 초기화</b><span>모든 기록 삭제 (동기화 중이면 배우자 기기에서도 삭제)</span></div>${ICON.right}</div>
    </div></section>
    <section class="card"><div class="card-h"><h3>📲 앱처럼 쓰기</h3></div>
      <p class="small ink2" style="margin:0 0 6px"><b>아이폰</b>: Safari 공유 버튼 → “홈 화면에 추가”<br><b>안드로이드</b>: Chrome 메뉴(⋮) → “홈 화면에 추가” 또는 “앱 설치”<br><b>PC</b>: Chrome 주소창 오른쪽 설치 아이콘</p>
      <p class="tiny muted" style="margin:8px 0 0">찌롱 <span class="love">♥</span> 두덩 v${APP_VERSION} · 🐻💕</p></section>
  </div></div>`;
  return { html };
}
