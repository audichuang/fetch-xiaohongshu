#!/bin/bash
# Usage: download_images.sh '[url1,url2,...]' /tmp/xhs_img
URLS_JSON="$1"
PREFIX="$2"

python3 - <<EOF
import json, subprocess, sys, os

urls = json.loads('''$URLS_JSON''')
procs = []
for i, url in enumerate(urls, 1):
    out = f"${PREFIX}_{i}.webp"
    p = subprocess.Popen([
        'curl', '-sf', '--max-time', '15',
        '-H', 'Referer: https://www.xiaohongshu.com/',
        '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        '-o', out, url
    ])
    procs.append((i, out, p))

for i, out, p in procs:
    p.wait()
    size = os.path.getsize(out) if os.path.exists(out) else 0
    status = "OK" if size > 10000 else "FAIL"
    print(f"{status} {i}: {size//1024}K")
EOF
