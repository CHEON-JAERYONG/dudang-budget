"""종목 목록(data/symbols.json) 새로 만들기 — 검색을 앱 안에서 즉시 하기 위한 사전 목록

    python tools/update_symbols.py

· 국내: 코스피·코스닥 전 종목 + ETF·ETN (네이버 증권, 시가총액 순)
· 미국: 나스닥·뉴욕·아멕스 시가총액 상위 + 인기 ETF
· 코인: 업비트 원화 마켓
GitHub Actions(.github/workflows/symbols.yml)가 매주 자동으로 실행해요.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

H = {'User-Agent': 'Mozilla/5.0 (dudang-budget symbol list)'}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'symbols.json')

US_TOP = {'NASDAQ': 800, 'NYSE': 800, 'AMEX': 120}
US_ETFS = (
    'SPY VOO IVV SPLG QQQ QQQM TQQQ SQQQ QLD SOXL SOXS SOXX SMH SCHD JEPI JEPQ VTI VT VEA VWO DIA IWM '
    'ARKK ARKG TLT TMF SHY IEF BND AGG SGOV BIL SHV GLD IAU SLV USO XLK XLF XLE XLV XLY XLP XLU XLI VNQ '
    'IBIT FBTC ETHA BITO VIG VYM DGRO SPYD SCHG VUG MGK UPRO SPXL TSLL NVDL CONL KORU EWY YINN FXI MCHI '
    'KWEB INDA EWJ DIVO QYLD XYLD RSP MTUM URA LIT ICLN TAN BOTZ CIBR NVDY TSLY MSTY CONY TLTW SPMO '
    'VGT XLC IGV FNGS BULZ TECL SOXQ USD SCHX ITOT'
).split()


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=H)
            return json.loads(urllib.request.urlopen(req, timeout=30).read())
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            print('  재시도', url, e, file=sys.stderr)
            time.sleep(2 + i * 3)


def num(s):
    try:
        return float(str(s).replace(',', ''))
    except ValueError:
        return 0.0


def domestic():
    rows = []
    for market, tag in (('KOSPI', 'P'), ('KOSDAQ', 'Q')):
        page = 1
        while True:
            j = get(f'https://m.stock.naver.com/api/stocks/marketValue/{market}?page={page}&pageSize=100')
            for s in j.get('stocks', []):
                kind = s.get('stockEndType')
                t = 'E' if kind == 'etf' else 'N' if kind == 'etn' else tag
                rows.append((num(s.get('marketValue')), s['itemCode'], s['stockName'].strip(), t))
            if page * 100 >= j.get('totalCount', 0) or not j.get('stocks'):
                break
            page += 1
            time.sleep(0.15)
        print(f'{market}: {page}쪽')
    rows.sort(key=lambda r: -r[0])
    seen, out = set(), []
    for _, code, name, t in rows:
        if code not in seen:
            seen.add(code)
            out.append([code, name, t])
    return out


EX_TAG = {'NASDAQ': 'O', 'NYSE': 'Y', 'AMEX': 'A'}


def us():
    rows = {}
    for ex, top in US_TOP.items():
        for page in range(1, top // 100 + 1):
            j = get(f'https://api.stock.naver.com/stock/exchange/{ex}/marketValue?page={page}&pageSize=100')
            for s in j.get('stocks', []):
                code = s.get('reutersCode')
                if code and code not in rows:
                    eng = (s.get('stockNameEng') or '').strip()
                    rows[code] = (num(s.get('marketValue')), [code, s.get('symbolCode') or code.split('.')[0], s['stockName'].strip(), eng, EX_TAG[ex]])
            time.sleep(0.15)
        print(f'{ex}: 상위 {top}')
    stocks = [r for _, r in sorted(rows.values(), key=lambda x: -x[0])]
    etfs = []
    for t in US_ETFS:
        try:
            j = get('https://ac.stock.naver.com/ac?q=' + urllib.parse.quote(t) + '&target=stock')
        except Exception as e:  # noqa: BLE001
            print('  ETF 실패', t, e, file=sys.stderr)
            continue
        for it in j.get('items', []):
            code = it.get('reutersCode') or it.get('code')
            if it.get('nationCode') == 'USA' and (it.get('code') or '').upper() == t and code not in rows:
                rows[code] = (0, None)
                etfs.append([code, t, it.get('name', t).strip(), '', EX_TAG.get(it.get('typeCode'), 'A')])
                break
        time.sleep(0.1)
    print(f'미국 ETF: {len(etfs)}개')
    return etfs + stocks  # 인기 ETF는 티커 검색이 많아 앞쪽에


def coins():
    j = [m for m in get('https://api.upbit.com/v1/market/all') if m['market'].startswith('KRW-')]
    # 거래대금 많은 순(비트 → 비트코인이 맨 위)
    vol = {}
    for i in range(0, len(j), 100):
        chunk = ','.join(m['market'] for m in j[i:i + 100])
        for t in get('https://api.upbit.com/v1/ticker?markets=' + chunk):
            vol[t['market']] = t.get('acc_trade_price_24h') or 0
        time.sleep(0.2)
    j.sort(key=lambda m: -vol.get(m['market'], 0))
    return [[m['market'], m.get('korean_name', ''), m.get('english_name', '')] for m in j]


def main():
    kst = timezone(timedelta(hours=9))
    data = {'updated': datetime.now(kst).strftime('%Y-%m-%d'), 'kr': domestic(), 'us': us(), 'cr': coins()}
    if len(data['kr']) < 2000 or len(data['us']) < 500:
        sys.exit(f"목록이 너무 짧아요(국내 {len(data['kr'])}, 미국 {len(data['us'])}) — 저장하지 않음")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # 한 종목당 한 줄 → git 변경 내역이 읽기 쉬움
    lines = ['{"updated":' + json.dumps(data['updated'])]
    for key in ('kr', 'us', 'cr'):
        body = ',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in data[key])
        lines.append(f',"{key}":[\n{body}\n]')
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(''.join(lines) + '}\n')
    print(f"저장: 국내 {len(data['kr'])} · 미국 {len(data['us'])} · 코인 {len(data['cr'])} → {OUT} ({os.path.getsize(OUT) // 1024}KB)")


if __name__ == '__main__':
    main()
