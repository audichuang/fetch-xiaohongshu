#!/usr/bin/env python3
"""
download_images.py — 並行下載小紅書圖片（純 Python，無 bash 依賴）

用法:
  python3 download_images.py '["url1","url2",...]' /tmp/xhs_img

特性:
  - concurrent.futures 真正並行下載（比 subprocess.Popen 更高效）
  - 自動 retry 一次失敗的下載
  - 退出碼：0=全部成功，1=有失敗
"""
import json
import os
import sys
import urllib.request

from concurrent.futures import ThreadPoolExecutor, as_completed

HEADERS = {
    "Referer": "https://www.xiaohongshu.com/",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
}
TIMEOUT = 15
MIN_SIZE = 10_000  # 10KB — below this is likely an error page


def download_one(i, url, out_path):
    """Download a single image. Returns (index, path, size, ok)."""
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = resp.read()
        with open(out_path, "wb") as f:
            f.write(data)
        size = len(data)
        return i, out_path, size, size > MIN_SIZE
    except Exception:
        return i, out_path, 0, False


def main():
    if len(sys.argv) < 3:
        print("Usage: download_images.py '<urls_json>' <prefix>", file=sys.stderr)
        sys.exit(2)

    urls = json.loads(sys.argv[1])
    prefix = sys.argv[2]

    if not urls:
        print("No URLs to download.", file=sys.stderr)
        sys.exit(0)

    os.makedirs(os.path.dirname(prefix) or ".", exist_ok=True)

    # Phase 1: parallel download
    results = {}
    with ThreadPoolExecutor(max_workers=min(len(urls), 8)) as pool:
        futures = {
            pool.submit(download_one, i, url, f"{prefix}_{i}.webp"): i
            for i, url in enumerate(urls, 1)
        }
        for fut in as_completed(futures):
            i, path, size, ok = fut.result()
            results[i] = (path, size, ok)

    # Phase 2: retry failures once
    failed = {i: r for i, r in results.items() if not r[2]}
    if failed:
        with ThreadPoolExecutor(max_workers=min(len(failed), 4)) as pool:
            futures = {
                pool.submit(download_one, i, urls[i - 1], results[i][0]): i
                for i in failed
            }
            for fut in as_completed(futures):
                i, path, size, ok = fut.result()
                results[i] = (path, size, ok)

    # Report
    has_fail = False
    for i in sorted(results):
        path, size, ok = results[i]
        status = "OK" if ok else "FAIL"
        if not ok:
            has_fail = True
        print(f"{status} {i}: {size // 1024}K")

    sys.exit(1 if has_fail else 0)


if __name__ == "__main__":
    main()
