// 두덩's 가계부 — 상수/카테고리 정의
export const APP_VERSION = '2.1.0';

// 데이터 저장소 (비공개 GitHub 저장소)
export const DEFAULT_REPO = { owner: 'CHEON-JAERYONG', repo: 'dudang-budget-data', path: 'data.json', branch: 'main' };

// 토큰 발급 페이지 (이름·권한·만료 없음 미리 채움, 저장소 선택만 직접)
export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'
  + '?name=' + encodeURIComponent('dudang-budget')
  + '&description=' + encodeURIComponent("두덩's 가계부 동기화용 (dudang-budget-data 저장소만 선택)")
  + '&expires_in=none&contents=write';

export const PERSONS = [
  { key: 'husband', label: '남편', emoji: '👨' },
  { key: 'wife', label: '아내', emoji: '👩' },
  { key: 'both', label: '공동', emoji: '👫' },
];

export const EXPENSE_CATS = [
  { key: 'food', name: '식비', emoji: '🍚' },
  { key: 'cafe', name: '카페·간식', emoji: '☕' },
  { key: 'card', name: '카드값', emoji: '💳' },
  { key: 'living', name: '생활용품', emoji: '🧴' },
  { key: 'home', name: '주거·관리비', emoji: '🏠' },
  { key: 'trans', name: '교통·차량', emoji: '🚗' },
  { key: 'comm', name: '통신', emoji: '📱' },
  { key: 'shop', name: '쇼핑', emoji: '🛍️' },
  { key: 'beauty', name: '미용', emoji: '💇' },
  { key: 'med', name: '의료·건강', emoji: '🏥' },
  { key: 'fun', name: '문화·여가', emoji: '🎬' },
  { key: 'travel', name: '여행', emoji: '✈️' },
  { key: 'gift', name: '경조사·선물', emoji: '🎁' },
  { key: 'insur', name: '보험', emoji: '🛡️' },
  { key: 'sub', name: '구독', emoji: '📺' },
  { key: 'etc', name: '기타', emoji: '📌' },
];

export const INCOME_CATS = [
  { key: 'salary', name: '월급', emoji: '💼' },
  { key: 'bonus', name: '상여금', emoji: '🎉' },
  { key: 'side', name: '부수입', emoji: '🍀' },
  { key: 'invest', name: '투자수익', emoji: '📈' },
  { key: 'allowance', name: '용돈·지원', emoji: '💝' },
  { key: 'refund', name: '환급·환불', emoji: '↩️' },
  { key: 'rent', name: '임대수익', emoji: '🏘️' },
  { key: 'etc', name: '기타', emoji: '📌' },
];

export const PAYS = [
  { key: 'card', name: '카드', emoji: '💳' },
  { key: 'cash', name: '현금', emoji: '💵' },
  { key: 'bank', name: '계좌이체', emoji: '🏦' },
  { key: 'pay', name: '간편결제', emoji: '📲' },
];

export const ASSET_TYPES = [
  { key: 'stock', name: '주식·ETF', emoji: '📊', market: true },
  { key: 'crypto', name: '코인', emoji: '💎', market: true },
  { key: 'saving', name: '예·적금', emoji: '🐷' },
  { key: 'cash', name: '통장·현금', emoji: '🏦' },
  { key: 'deposit', name: '전세·보증금', emoji: '🔑' },
  { key: 'real', name: '부동산', emoji: '🏘️' },
  { key: 'etc', name: '기타', emoji: '📌' },
];

export const LOAN_TYPES = [
  { key: 'jeonse', name: '전세대출', emoji: '🔑' },
  { key: 'mort', name: '주택담보', emoji: '🏡' },
  { key: 'credit', name: '신용대출', emoji: '🏦' },
  { key: 'minus', name: '마이너스통장', emoji: '💳' },
  { key: 'car', name: '자동차할부', emoji: '🚗' },
  { key: 'etc', name: '기타', emoji: '📌' },
];

export const REFRESH_OPTIONS = [
  { v: 30, label: '30초' },
  { v: 60, label: '1분' },
  { v: 180, label: '3분' },
  { v: 0, label: '수동' },
];
