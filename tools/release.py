# 새 버전 배포 전 실행: python tools/release.py 2.0.1
# 모든 ?v=, APP_VERSION, 서비스워커 캐시 이름을 한 번에 바꿔서
# 휴대폰이 예전 파일과 새 파일을 섞어 쓰지 않게 함
import re, sys, glob, os
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
new = sys.argv[1]
files = glob.glob('js/*.js') + ['index.html', 'sw.js']
for p in files:
    s = open(p, encoding='utf-8').read()
    s = re.sub(r'\?v=[\d.]+', '?v=' + new, s)
    s = re.sub(r"APP_VERSION = '[\d.]+'", f"APP_VERSION = '{new}'", s)
    s = re.sub(r"const CACHE = 'dudang-v[\d.]+'", f"const CACHE = 'dudang-v{new}'", s)
    open(p, 'w', encoding='utf-8').write(s)
print('version ->', new)
