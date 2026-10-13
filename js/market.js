// 실시간 시세 — API 키 없이 무료
//   · 국내주식/ETF: 네이버 증권 실시간 (지연 0초)  → 무료 공개 프록시 경유
//   · 해외주식: 네이버 증권 해외 실시간 → 원화 환산
//   · 코인: 업비트 공개 API (직접 호출)
//   · 환율: open.er-api.com (무료, 직접 호출)
// 종목 표기:  KR:005930  /  WS:AAPL.O  /  CR:KRW-BTC
import { loadJSON, saveJSON } from './util.js?v=2.0.0';

const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://cors-anywhere.fly.dev/${u}`,
];
let preferred = 0;

async function fetchWithTimeout(url, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
  } finally { clearTimeout(t); }
}

async function viaProxy(url, ms = 9000) {
  const bust = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
  const order = [preferred, ...PROXIES.map((_, i) => i).filter((i) => i !== preferred)];
  let lastErr;
  for (const i of order) {
    try {
      const res = await fetchWithTimeout(PROXIES[i](bust), ms);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const data = JSON.parse(text);
      preferred = i;
      return data;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('시세 서버 응답 없음');
}

const n = (v) => {
  const x = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(x) ? x : 0;
};

// ===== 환율 =====
const FX_KEY = 'dudang3.fx';
let fx = loadJSON(FX_KEY) || { rates: { KRW: 1400, USD: 1 }, ts: 0 };
export const fxInfo = () => fx;
export function krwPer(cur) {
  if (!cur || cur === 'KRW') return 1;
  const r = fx.rates || {};
  if (!r.KRW || !r[cur]) return cur === 'USD' ? r.KRW || 1400 : 0;
  return r.KRW / r[cur];
}
// 전체 통화표(하루 1회 갱신) + 달러 환율은 네이버(하나은행 고시) 실시간으로 덮어씀
export async function refreshFx({ force = false, live = false } = {}) {
  if (force || Date.now() - (fx.ts || 0) > 60 * 60e3) {
    try {
      const res = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD', 8000);
      const j = await res.json();
      if (j?.rates?.KRW) fx = { ...fx, rates: j.rates, ts: Date.now(), updated: (j.time_last_update_unix || 0) * 1000, source: '일간 환율' };
    } catch (e) { console.warn('환율 조회 실패', e.message); }
  }
  if (live && Date.now() - (fx.liveTs || 0) > 50e3) {
    try {
      const j = await viaProxy('https://m.stock.naver.com/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_USDKRW', 8000);
      const krw = n(j?.result?.closePrice);
      if (krw > 500) {
        fx = { ...fx, rates: { ...(fx.rates || {}), USD: 1, KRW: krw }, liveTs: Date.now(), updated: Date.parse(j.result.localTradedAt) || Date.now(), source: '하나은행 실시간' };
      }
    } catch (e) { console.warn('실시간 환율 실패', e.message); }
  }
  saveJSON(FX_KEY, fx);
  return fx;
}

// ===== 시세 캐시 (기기별, 동기화하지 않음) =====
const Q_KEY = 'dudang3.quotes';
let quotes = loadJSON(Q_KEY) || {};
export const getQuote = (sym) => quotes[sym] || null;
export const lastQuoteTime = () => Math.max(0, ...Object.values(quotes).map((q) => q.fetchedAt || 0));

// 예전 버전 티커 → 새 표기
export function normalizeSymbol(t) {
  if (!t) return '';
  const s = String(t).trim();
  if (/^(KR|WS|CR):/.test(s)) return s;
  const u = s.toUpperCase();
  if (/^(KRW|BTC|USDT)-/.test(u)) return 'CR:' + u;
  const m = u.match(/^([0-9A-Z]{6})\.(KS|KQ)$/);
  if (m) return 'KR:' + m[1];
  if (/^\d{6}$/.test(u) || /^[0-9][0-9A-Z]{5}$/.test(u)) return 'KR:' + u;
  return 'WS:' + u;
}
export const symbolLabel = (sym) => (sym || '').replace(/^(KR|WS|CR):/, '');

function parseNaver(d, kind) {
  const cur = d.currencyType?.code || (kind === 'KR' ? 'KRW' : 'USD');
  const price = n(d.closePriceRaw ?? d.closePrice);
  const change = n(d.compareToPreviousClosePriceRaw ?? d.compareToPreviousClosePrice);
  const sign = d.compareToPreviousPrice?.name === 'FALLING' || d.compareToPreviousPrice?.code === '5' || d.compareToPreviousPrice?.code === '4' ? -1 : 1;
  const signedChange = change < 0 ? change : sign * change;
  const ratio = n(d.fluctuationsRatioRaw ?? d.fluctuationsRatio);
  const signedRatio = ratio < 0 ? ratio : sign * ratio;
  return {
    name: d.stockName,
    price,
    change: signedChange,
    pct: signedRatio,
    currency: cur,
    market: d.marketStatus || '',
    exchange: d.stockExchangeType?.nameKor || d.stockExchangeType?.name || '',
    tradedAt: d.localTradedAt ? Date.parse(d.localTradedAt) : 0,
    delay: d.stockExchangeType?.delayTime ?? 0,
  };
}

async function fetchNaverGroup(kind, codes) {
  const out = {};
  const base = kind === 'KR'
    ? 'https://polling.finance.naver.com/api/realtime/domestic/stock/'
    : 'https://polling.finance.naver.com/api/realtime/worldstock/stock/';
  for (let i = 0; i < codes.length; i += 20) {
    const chunk = codes.slice(i, i + 20);
    const data = await viaProxy(base + chunk.map(encodeURIComponent).join(','));
    for (const d of data?.datas || []) {
      const code = kind === 'KR' ? d.itemCode : d.reutersCode;
      if (code) out[`${kind}:${code}`] = parseNaver(d, kind);
    }
  }
  return out;
}

async function fetchUpbit(markets) {
  const out = {};
  if (!markets.length) return out;
  const res = await fetchWithTimeout('https://api.upbit.com/v1/ticker?markets=' + markets.map(encodeURIComponent).join(','));
  if (!res.ok) throw new Error('업비트 응답 오류');
  for (const d of await res.json()) {
    out['CR:' + d.market] = {
      price: d.trade_price, change: d.signed_change_price, pct: d.signed_change_rate * 100,
      currency: 'KRW', market: 'OPEN', exchange: '업비트', tradedAt: d.trade_timestamp, delay: 0,
    };
  }
  return out;
}

let refreshing = null;
// symbols: ['KR:005930', 'WS:AAPL.O', 'CR:KRW-BTC'] → { ok, failed }
export function refreshQuotes(symbols) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const uniq = [...new Set(symbols.filter(Boolean))];
    const kr = uniq.filter((s) => s.startsWith('KR:')).map((s) => s.slice(3));
    const ws = uniq.filter((s) => s.startsWith('WS:')).map((s) => s.slice(3));
    const cr = uniq.filter((s) => s.startsWith('CR:')).map((s) => s.slice(3));
    const jobs = [refreshFx({ live: ws.length > 0 })];
    const results = {};
    let failed = 0;
    const run = (p) => p.then((r) => Object.assign(results, r)).catch((e) => { failed++; console.warn('시세 실패', e.message); });
    if (kr.length) jobs.push(run(fetchNaverGroup('KR', kr)));
    if (ws.length) jobs.push(run(fetchNaverGroup('WS', ws)));
    if (cr.length) jobs.push(run(fetchUpbit(cr)));
    await Promise.all(jobs);
    const now = Date.now();
    for (const [sym, q] of Object.entries(results)) {
      if (q.price > 0) quotes[sym] = { ...q, krw: q.price * krwPer(q.currency), fetchedAt: now };
    }
    saveJSON(Q_KEY, quotes);
    const missing = uniq.filter((s) => !results[s]);
    return { ok: Object.keys(results).length, failed, missing };
  })().finally(() => { refreshing = null; });
  return refreshing;
}

// 원화 환산 현재가 (환율 최신값 반영)
export function priceKRW(sym) {
  const q = quotes[sym];
  if (!q) return 0;
  return q.price * krwPer(q.currency);
}

// ===== 종목 검색 =====
let upbitMarkets = null;
async function getUpbitMarkets() {
  if (upbitMarkets) return upbitMarkets;
  try {
    const res = await fetchWithTimeout('https://api.upbit.com/v1/market/all');
    upbitMarkets = (await res.json()).filter((m) => m.market.startsWith('KRW-'));
  } catch { upbitMarkets = []; }
  return upbitMarkets;
}

const MARKET_LABEL = { KOSPI: '🇰🇷 코스피', KOSDAQ: '🇰🇷 코스닥', KONEX: '🇰🇷 코넥스', NASDAQ: '🇺🇸 나스닥', NYSE: '🇺🇸 뉴욕', AMEX: '🇺🇸 아멕스', TOKYO: '🇯🇵 도쿄', HONGKONG: '🇭🇰 홍콩', SHANGHAI: '🇨🇳 상하이', SHENZHEN: '🇨🇳 선전' };

export async function searchSymbols(q) {
  q = (q || '').trim();
  if (!q) return [];
  const lq = q.toLowerCase();
  const [naver, markets] = await Promise.all([
    viaProxy('https://ac.stock.naver.com/ac?q=' + encodeURIComponent(q) + '&target=stock', 8000).catch(() => null),
    getUpbitMarkets(),
  ]);
  const stocks = [];
  for (const it of naver?.items || []) {
    if (it.category && it.category !== 'stock') continue;
    const isKR = it.nationCode === 'KOR';
    stocks.push({
      symbol: isKR ? 'KR:' + it.code : 'WS:' + (it.reutersCode || it.code),
      name: it.name,
      code: it.code,
      market: MARKET_LABEL[it.typeCode] || it.typeName || it.typeCode || '',
      type: 'stock',
    });
  }
  const coins = markets
    .filter((m) => (m.korean_name || '').toLowerCase().includes(lq) || (m.english_name || '').toLowerCase().includes(lq) || m.market.toLowerCase().includes(lq))
    .sort((a, b) => Number(!(a.korean_name || '').startsWith(q)) - Number(!(b.korean_name || '').startsWith(q)))
    .slice(0, 4)
    .map((m) => ({ symbol: 'CR:' + m.market, name: m.korean_name, code: m.market.replace('KRW-', ''), market: '💎 업비트', type: 'crypto' }));
  // 코인 이름이 검색어로 시작하면(예: 비트 → 비트코인) 코인을 먼저
  const coinFirst = coins.some((c) => c.name.startsWith(q) || c.code.toLowerCase() === lq);
  const out = coinFirst ? [...coins, ...stocks.slice(0, 8)] : [...stocks.slice(0, 8), ...coins];
  const seen = new Set();
  return out.filter((x) => !seen.has(x.symbol) && seen.add(x.symbol)).slice(0, 12);
}

// 장 상태 라벨
export function marketState(q) {
  if (!q) return { label: '시세 없음', tone: 'muted' };
  if (q.exchange === '업비트') return { label: '24시간', tone: 'good' };
  if (q.market === 'OPEN') return { label: '장중 · 실시간', tone: 'good' };
  if (q.market === 'PRE_OPEN' || q.market === 'PREOPEN') return { label: '장 시작 전', tone: 'warn' };
  return { label: '장 마감', tone: 'muted' };
}
