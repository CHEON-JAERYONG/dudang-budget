// 화면 공통 상태 + 계산 함수
import { all, kv, getDevice } from './store.js?v=2.0.0';
import { PERSONS, EXPENSE_CATS, INCOME_CATS, PAYS, ASSET_TYPES, LOAN_TYPES } from './config.js?v=2.0.0';
import { ym, today, daysInMonth, addMonths, parseYmd, compactWon, won, loadJSON } from './util.js?v=2.0.0';
import { getQuote, krwPer } from './market.js?v=2.0.0';

export const ui = {
  route: 'home',
  month: ym(),
  list: { mode: 'list', type: 'all', person: 'all', cat: 'all', q: '' },
  calSel: null,
  statsMode: 'month',
  statsYear: new Date().getFullYear(),
  assetsTab: 'invest',
  expandCat: null,
  quoteBusy: false,
  quoteErr: '',
};

export const isDesktop = () => window.matchMedia('(min-width: 960px)').matches;

// ===== 사람 =====
export function names() {
  const n = kv('names', {}) || {};
  return { husband: n.husband || '남편', wife: n.wife || '아내', both: '공동' };
}
export function person(k) {
  const p = PERSONS.find((x) => x.key === k) || PERSONS[2];
  return { ...p, name: names()[p.key] };
}
export const personTag = (k) => { const p = person(k); return `${p.emoji} ${p.name}`; };
export const me = () => getDevice().me || 'both';
export const PERSON_COLOR = { husband: '--p-husband', both: '--p-both', wife: '--p-wife' };

// ===== 카테고리 =====
export function catList(type, { includeHidden = false } = {}) {
  const base = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
  const custom = kv(`cats.${type}.custom`, []) || [];
  const hidden = new Set(kv(`cats.${type}.hidden`, []) || []);
  const etc = base.find((c) => c.key === 'etc');
  const list = [...base.filter((c) => c.key !== 'etc'), ...custom, etc];
  return includeHidden ? list : list.filter((c) => !hidden.has(c.key));
}
export function cat(type, key) {
  return catList(type, { includeHidden: true }).find((c) => c.key === key)
    || (type === 'income' ? INCOME_CATS : EXPENSE_CATS).find((c) => c.key === 'etc');
}
export const pay = (k) => PAYS.find((p) => p.key === k);
export const assetType = (k) => ASSET_TYPES.find((a) => a.key === k) || ASSET_TYPES[ASSET_TYPES.length - 1];
export const loanType = (k) => LOAN_TYPES.find((a) => a.key === k) || LOAN_TYPES[LOAN_TYPES.length - 1];

// ===== 거래 집계 =====
export const txMonth = (m) => all('tx').filter((t) => t.date && t.date.startsWith(m));
export const txYear = (y) => all('tx').filter((t) => t.date && t.date.startsWith(String(y)));
export function totals(list) {
  let inc = 0, exp = 0;
  for (const t of list) { if (t.type === 'income') inc += t.amount || 0; else exp += t.amount || 0; }
  return { inc, exp, net: inc - exp, rate: inc > 0 ? ((inc - exp) / inc) * 100 : null };
}
export function sumBy(list, keyFn) {
  const m = new Map();
  for (const t of list) { const k = keyFn(t); m.set(k, (m.get(k) || 0) + (t.amount || 0)); }
  return m;
}
export const expensesOf = (list) => list.filter((t) => t.type !== 'income');
export const monthsBack = (m, n) => Array.from({ length: n }, (_, i) => addMonths(m, i - n + 1));
export function sortTx(list) {
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
}

// 예산
export const budgetTotal = () => Number(kv('budget.total', 0)) || 0;
export const budgetCat = (k) => Number(kv('budget.cat.' + k, 0)) || 0;

// 이번 달 경과 비율 (선택 월이 이번 달이 아니면 1 또는 0)
export function monthProgress(m) {
  const cur = ym();
  if (m < cur) return { frac: 1, daysLeft: 0, day: daysInMonth(m) };
  if (m > cur) return { frac: 0, daysLeft: daysInMonth(m), day: 0 };
  const d = new Date().getDate(), dim = daysInMonth(m);
  return { frac: d / dim, daysLeft: dim - d + 1, day: d };
}

// ===== 고정지출 =====
export const recTxId = (ruleId, m) => `rc_${ruleId}_${m.replace('-', '')}`;
export function ruleDate(rule, m) {
  const d = Math.min(Number(rule.day) || 1, daysInMonth(m));
  return `${m}-${String(d).padStart(2, '0')}`;
}

// ===== 자산 =====
export function holdingValue(h) {
  const t = assetType(h.type);
  if (t.market && h.symbol) {
    const q = getQuote(h.symbol);
    const cur = (q && q.currency) || h.currency || 'KRW';
    const fxNow = krwPer(cur) || 1;
    const foreign = cur !== 'KRW';
    const qty = Number(h.qty) || 0;
    const live = Boolean(q) && !h.manualPrice;
    const unit = h.manualPrice ? Number(h.manualPrice) : q ? q.price : Number(h.avg) || 0;
    const unitKRW = unit * (foreign ? fxNow : 1);
    const value = qty * unitKRW;
    const cost = qty * (Number(h.avg) || 0) * (foreign ? Number(h.buyFx) || fxNow : 1);
    const day = live ? qty * (q.change || 0) * (foreign ? fxNow : 1) : 0;
    return { value, cost, pl: value - cost, plPct: cost ? ((value - cost) / cost) * 100 : 0, day, quote: q, unit, unitKRW, currency: cur, foreign, live };
  }
  const value = Number(h.amount) || 0, cost = Number(h.principal) || 0;
  return { value, cost, pl: cost ? value - cost : 0, plPct: cost ? ((value - cost) / cost) * 100 : 0, day: 0, quote: null, unit: 0, unitKRW: 0, currency: 'KRW', foreign: false, live: false };
}

export function netWorth() {
  let assets = 0, cost = 0, day = 0, marketValue = 0, marketCost = 0;
  for (const h of all('invest')) {
    const v = holdingValue(h);
    assets += v.value;
    if (assetType(h.type).market) { marketValue += v.value; marketCost += v.cost; day += v.day; }
    cost += v.cost;
  }
  const debts = all('loans').reduce((s, l) => s + (Number(l.remaining) || 0), 0);
  return { assets, debts, net: assets - debts, marketValue, marketCost, marketPl: marketValue - marketCost, day };
}

export function goalCurrent(g) {
  return (Number(g.initial) || 0) + all('goalLogs').filter((l) => l.goalId === g.id).reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

// ===== 결혼 D-day =====
export function dday() {
  const w = kv('wedding', '');
  if (!w) return '';
  const diff = Math.round((parseYmd(today()) - parseYmd(w)) / 864e5);
  if (diff >= 0) return `결혼 ${(diff + 1).toLocaleString()}일째`;
  return `결혼식 D-${-diff}`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '늦은 밤이에요';
  if (h < 11) return '좋은 아침이에요';
  if (h < 17) return '좋은 오후예요';
  if (h < 22) return '오늘도 수고했어요';
  return '편안한 밤 보내요';
}

// ===== 기기별 설정 (동기화 X) =====
export const refreshSec = () => { const v = loadJSON('dudang3.refresh'); return v === null ? 60 : Number(v); };

// ===== 차트 =====
export const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const charts = [];
export function mkChart(canvas, config) {
  if (!window.Chart || !canvas) return null;
  const c = new window.Chart(canvas, config);
  charts.push(c);
  return c;
}
export function destroyCharts() { while (charts.length) charts.pop().destroy(); }

export function chartOptions({ legend = true, stacked = false, money = true } = {}) {
  const ink2 = cssVar('--ink-2'), ink3 = cssVar('--ink-3'), grid = cssVar('--grid'), ink = cssVar('--ink'), surface = cssVar('--surface');
  const font = { family: cssVar('--font') || 'sans-serif', size: 12, weight: '600' };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: legend ? { position: 'top', align: 'start', labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 14, color: ink2, font } } : { display: false },
      tooltip: {
        backgroundColor: ink, titleColor: surface, bodyColor: surface, padding: 10, cornerRadius: 10, boxPadding: 4,
        titleFont: font, bodyFont: { ...font, weight: '500' },
        callbacks: { label: (ctx) => ` ${ctx.dataset.label ? ctx.dataset.label + ' ' : ''}${money ? won(ctx.raw) : ctx.raw}` },
      },
    },
    scales: {
      x: { stacked, grid: { display: false }, border: { display: false }, ticks: { color: ink3, font } },
      y: { stacked, beginAtZero: true, grid: { color: grid, lineWidth: 1, drawTicks: false }, border: { display: false }, ticks: { color: ink3, font, padding: 8, maxTicksLimit: 5, callback: (v) => (money ? compactWon(v) : v) } },
    },
  };
}
export const barStyle = (color) => ({
  backgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24, categoryPercentage: 0.72, barPercentage: 0.9,
});
