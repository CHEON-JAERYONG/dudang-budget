// 실시간 시세 — API 키 없이 무료
//   · 국내주식/ETF: 네이버 증권 실시간 (지연 0초)  → 무료 공개 프록시 경유
//   · 해외주식: 네이버 증권 해외 실시간 → 원화 환산
//   · 코인: 업비트 공개 API (직접 호출)
//   · 환율: open.er-api.com (무료, 직접 호출)
// 종목 표기:  KR:005930  /  WS:AAPL.O  /  CR:KRW-BTC
import { loadJSON, saveJSON } from './util.js?v=2.1.3';

const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://cors-anywhere.fly.dev/${u}`,
];
// 마지막으로 잘 된 중계 서버를 기억 (다음에 앱을 열 때도 그 서버부터)
const PROXY_KEY = 'dudang3.proxy';
let preferred = Number(loadJSON(PROXY_KEY)) || 0;
if (!PROXIES[preferred]) preferred = 0;

async function fetchWithTimeout(url, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
  } finally { clearTimeout(t); }
}

// 먼저 잘 되던 서버에 묻고, 실패하거나 hedgeMs 안에 답이 없으면 다음 서버에도 동시에 물어서 먼저 온 답을 씀
function viaProxy(url, ms = 9000, hedgeMs = 1500) {
  const bust = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
  const order = [preferred, ...PROXIES.map((_, i) => i).filter((i) => i !== preferred)];
  return new Promise((resolve, reject) => {
    let next = 0, running = 0, done = false, lastErr;
    const ctrls = [];
    const launch = () => {
      if (done || next >= order.length) return;
      const i = order[next++];
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      running++;
      const timer = setTimeout(() => ctrl.abort(), ms);
      const hedge = setTimeout(launch, hedgeMs);
      fetch(PROXIES[i](bust), { signal: ctrl.signal, cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return JSON.parse(await res.text());
        })
        .then((data) => {
          if (done) return;
          done = true;
          ctrls.forEach((c) => c !== ctrl && c.abort());
          if (preferred !== i) { preferred = i; saveJSON(PROXY_KEY, i); }
          resolve(data);
        })
        .catch((e) => {
          lastErr = e;
          clearTimeout(hedge);
          launch();
        })
        .finally(() => {
          clearTimeout(timer);
          running--;
          if (!done && !running && next >= order.length) reject(lastErr || new Error('시세 서버 응답 없음'));
        });
    };
    launch();
  });
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

async function fetchNaverGroup(kind, codes, hedgeMs) {
  const out = {};
  const base = kind === 'KR'
    ? 'https://polling.finance.naver.com/api/realtime/domestic/stock/'
    : 'https://polling.finance.naver.com/api/realtime/worldstock/stock/';
  for (let i = 0; i < codes.length; i += 20) {
    const chunk = codes.slice(i, i + 20);
    const data = await viaProxy(base + chunk.map(encodeURIComponent).join(','), 9000, hedgeMs);
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

let refreshing = null, refreshingSet = new Set();
// symbols: ['KR:005930', 'WS:AAPL.O', 'CR:KRW-BTC'] → { ok, failed }
// fast: 사람이 직접 누른 조회 — 중계 서버 두 곳에 동시에 물어 가장 빠른 답을 씀
export function refreshQuotes(symbols, { fast = false } = {}) {
  if (refreshing) {
    // 자동 갱신 중에 새 종목을 고르면, 갱신이 끝난 뒤 그 종목도 바로 조회
    if (symbols.every((s) => !s || refreshingSet.has(s))) return refreshing;
    return refreshing.catch(() => {}).then(() => refreshQuotes(symbols, { fast }));
  }
  refreshingSet = new Set(symbols);
  refreshing = (async () => {
    const uniq = [...new Set(symbols.filter(Boolean))];
    const kr = uniq.filter((s) => s.startsWith('KR:')).map((s) => s.slice(3));
    const ws = uniq.filter((s) => s.startsWith('WS:')).map((s) => s.slice(3));
    const cr = uniq.filter((s) => s.startsWith('CR:')).map((s) => s.slice(3));
    const jobs = [refreshFx({ live: ws.length > 0 })];
    const results = {};
    let failed = 0;
    const run = (p) => p.then((r) => Object.assign(results, r)).catch((e) => { failed++; console.warn('시세 실패', e.message); });
    const hedge = fast ? 0 : 1500;
    if (kr.length) jobs.push(run(fetchNaverGroup('KR', kr, hedge)));
    if (ws.length) jobs.push(run(fetchNaverGroup('WS', ws, hedge)));
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
// ① 앱에 들어 있는 종목 목록(data/symbols.json — 국내 전 종목·ETF, 미국 주요 종목, 코인 / 매주 자동 갱신)에서 바로 찾고
// ② 목록에 없는 종목(신규 상장, 작은 해외 종목 등)만 네이버 검색으로 보충
let upbitMarkets = null;
async function getUpbitMarkets() {
  if (upbitMarkets) return upbitMarkets;
  try {
    const res = await fetchWithTimeout('https://api.upbit.com/v1/market/all', 6000);
    upbitMarkets = (await res.json()).filter((m) => m.market.startsWith('KRW-'));
  } catch { upbitMarkets = []; }
  return upbitMarkets;
}

const MARKET_LABEL = { KOSPI: '🇰🇷 코스피', KOSDAQ: '🇰🇷 코스닥', KONEX: '🇰🇷 코넥스', NASDAQ: '🇺🇸 나스닥', NYSE: '🇺🇸 뉴욕', AMEX: '🇺🇸 아멕스', TOKYO: '🇯🇵 도쿄', HONGKONG: '🇭🇰 홍콩', SHANGHAI: '🇨🇳 상하이', SHENZHEN: '🇨🇳 선전' };
const KR_LABEL = { P: '🇰🇷 코스피', Q: '🇰🇷 코스닥', E: '🇰🇷 ETF', N: '🇰🇷 ETN' };
const US_LABEL = { O: '🇺🇸 나스닥', Y: '🇺🇸 뉴욕', A: '🇺🇸 아멕스' };

// 한글 초성(ㅅㅅㅈㅈ → 삼성전자)·입력 중인 글자(삼서 → 삼성)도 맞춰 줌
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const HANGUL = 0xac00, HANGUL_N = 11172;
const keyOf = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
function chMatch(q, ch, last) {
  if (q === ch) return true;
  const nc = ch.charCodeAt(0) - HANGUL;
  if (nc < 0 || nc >= HANGUL_N) return false;
  const qc = q.charCodeAt(0);
  if (qc >= 0x3131 && qc <= 0x314e) return CHO[Math.floor(nc / 588)] === q;
  const qs = qc - HANGUL;
  return last && qs >= 0 && qs < HANGUL_N && qs % 28 === 0 && Math.floor(nc / 28) === qs / 28;
}
function matchAt(k, q, p) {
  for (let j = 0; j < q.length; j++) if (!chMatch(q[j], k[p + j], j === q.length - 1)) return false;
  return true;
}
function findIn(k, q) { // 0: 앞부분 일치, 1: 중간 포함, -1: 없음
  for (let p = 0; p + q.length <= k.length; p++) if (matchAt(k, q, p)) return p === 0 ? 0 : 1;
  return -1;
}
function score(x, q) {
  if (x.c === q || x.k === q) return 0;
  const f = findIn(x.k, q);
  if (f === 0) return 1;
  if (q.length >= 2 && x.c.startsWith(q)) return 1;
  if (x.e && x.e.startsWith(q)) return 2;
  if (f === 1) return 3;
  if (q.length >= 2 && x.e && x.e.includes(q)) return 4;
  return -1;
}

// 한글로 치는 영문 종목명·ETF 브랜드·줄임말 (네이버 → NAVER, 타이거 → TIGER, 삼전 → 삼성전자)
const ALIASES = [
  ['삼전', '삼성전자'], ['하닉', 'sk하이닉스'], ['엔솔', 'lg에너지솔루션'], ['삼바', '삼성바이오로직스'], ['카뱅', '카카오뱅크'], ['현차', '현대차'],
  ['네이버', 'naver'], ['에스케이', 'sk'], ['엘지', 'lg'], ['케이티앤지', 'kt&g'], ['케이티', 'kt'], ['케이비', 'kb'], ['씨제이', 'cj'], ['지에스', 'gs'],
  ['에이치디', 'hd'], ['에스오일', 's-oil'], ['엘에스', 'ls'], ['디비', 'db'], ['에이치엘비', 'hlb'], ['비엔케이', 'bnk'], ['제이비', 'jb'],
  ['타이거', 'tiger'], ['코덱스', 'kodex'], ['에이스', 'ace'], ['라이즈', 'rise'], ['쏠', 'sol'], ['플러스', 'plus'], ['킨덱스', 'kindex'],
  ['아리랑', 'arirang'], ['하나로', 'hanaro'], ['키움', 'kiwoom'], ['타임폴리오', 'timefolio'], ['코액트', 'koact'], ['파워', 'power'],
  ['리플', '엑스알피'],
];
function aliasOf(k) {
  for (const [ko, en] of ALIASES) if (k.startsWith(ko)) return en + k.slice(ko.length);
  if (k.length >= 2) for (const [ko, en] of ALIASES) if (ko.startsWith(k)) return en; // 치는 중(네이 → naver)
  return '';
}

// group: 0 코인(이름이 맞으면 먼저 — 비트 → 비트코인), 1 국내, 2 미국 / rank: 시가총액·거래대금 순위
const entry = (group, rank, symbol, name, code, market, type, eng = '') => ({ group, rank, symbol, name, code, market, type, k: keyOf(name), c: code.toLowerCase(), e: keyOf(eng) });
let symIndex = null, symLoading = null;

export function loadSymbols() {
  if (symIndex) return Promise.resolve(symIndex);
  if (!symLoading) {
    symLoading = fetch('data/symbols.json')
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => {
        const list = [];
        (d.cr || []).forEach(([m, name, eng], i) => list.push(entry(0, i, 'CR:' + m, name, m.replace('KRW-', ''), '💎 업비트', 'crypto', eng)));
        (d.kr || []).forEach(([code, name, t], i) => list.push(entry(1, i, 'KR:' + code, name, code, KR_LABEL[t] || '🇰🇷', 'stock')));
        (d.us || []).forEach(([rc, sym, name, eng, ex], i) => list.push(entry(2, i, 'WS:' + rc, name, sym, US_LABEL[ex] || '🇺🇸', 'stock', eng)));
        symIndex = { list, updated: d.updated };
        // 목록 갱신 뒤 새로 상장된 코인은 업비트에서 바로 받아 추가
        getUpbitMarkets().then((live) => {
          const have = new Set(list.map((x) => x.symbol));
          live.forEach((m, i) => { if (!have.has('CR:' + m.market)) list.push(entry(0, 1000 + i, 'CR:' + m.market, m.korean_name, m.market.replace('KRW-', ''), '💎 업비트', 'crypto', m.english_name)); });
        });
        return symIndex;
      })
      .catch((e) => { symLoading = null; console.warn('종목 목록 실패', e.message); return null; });
  }
  return symLoading;
}

// 앱 안 목록에서 즉시 검색 (목록을 못 받았으면 null)
export async function searchLocal(q, limit = 12) {
  const db = await loadSymbols();
  if (!db) return null;
  const k = keyOf(q);
  if (!k) return [];
  const k2 = aliasOf(k);
  const hits = [];
  for (const x of db.list) {
    let s = score(x, k);
    if (k2) { const s2 = score(x, k2); if (s2 >= 0 && (s < 0 || s2 < s)) s = s2; }
    // 코인은 한글 이름이 검색어로 시작할 때만 주식보다 먼저 (비트 → 비트코인), 아니면 맨 뒤로
    if (s >= 0) hits.push([s, x.group === 0 && findIn(x.k, k) !== 0 && !(k2 && findIn(x.k, k2) === 0) ? 3 : x.group, x]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].rank - b[2].rank);
  return hits.slice(0, limit).map(([, , x]) => ({ symbol: x.symbol, name: x.name, code: x.code, market: x.market, type: x.type }));
}

// 네이버 검색 (중계 서버 경유 — 느릴 수 있어 보충용)
const remoteCache = new Map();
export async function searchRemote(q) {
  q = (q || '').trim();
  if (!q) return [];
  if (remoteCache.has(q)) return remoteCache.get(q);
  const naver = await viaProxy('https://ac.stock.naver.com/ac?q=' + encodeURIComponent(q) + '&target=stock', 8000, 0);
  const out = [];
  for (const it of naver?.items || []) {
    if (it.category && it.category !== 'stock') continue;
    const isKR = it.nationCode === 'KOR';
    out.push({
      symbol: isKR ? 'KR:' + it.code : 'WS:' + (it.reutersCode || it.code),
      name: it.name,
      code: it.code,
      market: MARKET_LABEL[it.typeCode] || it.typeName || it.typeCode || '',
      type: 'stock',
    });
  }
  remoteCache.set(q, out);
  return out;
}

export async function searchSymbols(q) {
  const local = (await searchLocal(q)) || [];
  if (local.length >= 5) return local;
  const remote = await searchRemote(q).catch(() => []);
  const seen = new Set(local.map((x) => x.symbol));
  return [...local, ...remote.filter((x) => !seen.has(x.symbol))].slice(0, 12);
}

// 장 상태 라벨
export function marketState(q) {
  if (!q) return { label: '시세 없음', tone: 'muted' };
  if (q.exchange === '업비트') return { label: '24시간', tone: 'good' };
  if (q.market === 'OPEN') return { label: '장중 · 실시간', tone: 'good' };
  if (q.market === 'PRE_OPEN' || q.market === 'PREOPEN') return { label: '장 시작 전', tone: 'warn' };
  return { label: '장 마감', tone: 'muted' };
}
