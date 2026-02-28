***

name: fetch-xiaohongshu
description: "Fetch xiaohongshu (小紅書) post content and images using OpenClaw browser. Single-call extraction from **INITIAL\_STATE** gets metadata + all image URLs (no lazy-load issues). Parallel curl download (~1 sec for 22 imgs). Fallback: canvas extraction per image. Returns structured data: title, author, desc, tags, imageUrls, and local image file paths. Does NOT upload to MinIO. Atomic skill for xiaohongshu extraction. Trigger keywords: 小紅書, xiaohongshu, xhslink, 紅書."
----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# Fetch Xiaohongshu — 小紅書擷取原子技能

從小紅書貼文擷取文字 metadata 與圖片，將圖片存至本機暫存，回傳結構化資料。

> **這是原子技能**：只負責「抓取」——metadata 萃取 + 圖片下載到本機。
> **不負責**：圖片讀取解析、MinIO 上傳、內容整合、存入 Obsidian。

## 輸入

* `url`: 小紅書分享連結（`xiaohongshu.com` 或 `xhslink.com`）

## 輸出

```json
{
  "title": "貼文標題",
  "author": "作者名稱",
  "desc": "貼文說明文字",
  "tags": ["標籤1", "標籤2"],
  "imageCount": 5,
  "imageUrls": ["https://...webp_3", "..."],
  "localFiles": ["/tmp/xhs_img_1.webp", "/tmp/xhs_img_2.webp", "..."]
}
```

> `localFiles` 為本機暫存路徑，呼叫方（編排技能）負責讀取圖片內容與上傳。

## 技術背景

* **資料來源**：一律從 `window.__INITIAL_STATE__` 萃取 metadata 與圖片 URL，避免 DOM 懶加載遺漏問題。
* **快速路徑（curl）**：State 中的 URL 含 `!nd_dft_wlteh_webp_3` suffix，可直接 curl 下載，只需 `Referer` + `User-Agent` header，不需 cookie。5 張並行 ~0.5 秒。
* **協定正規化**：State URL 可能是 `http://`，腳本自動轉為 `https://`。
* **備用路徑（Canvas）**：僅在 curl 失敗時使用。CDP `evaluate` 不強制 canvas taint policy，已載入的 `<img>` 可直接畫到 canvas 取得 base64。
* **為何用 openclaw profile**：CDP 直連，不透過 Chrome Extension relay，更穩定。

## 工作流程

### 步驟 1：開啟瀏覽器並導航

```
action: start, profile: openclaw
action: navigate, targetUrl: <URL>
```

> **注意**：參數名稱是 `targetUrl`，不是 `url`。

### 步驟 2：處理登入彈窗

1. action: `press`，key: `Escape`
2. 若仍有彈窗，在 snapshot 找叉叉按鈕並 `click`
3. 若彈窗只在左側欄、右側文章內容可見 → 直接忽略，繼續

### 步驟 3：一次萃取全部資料（metadata + 圖片 URL）

```bash
openclaw browser evaluate --browser-profile openclaw \
  --fn "$(cat ~/skills/fetch-xiaohongshu/scripts/extract_all.js)"
```

回傳包含：

| 欄位 | 說明 |
|------|------|
| `type` | `"normal"` 或 `"video"` |
| `title` | 貼文標題 |
| `desc` | 說明文字 |
| `author` | 作者暱稱 |
| `tags` | 標籤陣列 |
| `imageCount` | 圖片數量（0 = 純文字貼文） |
| `imageUrls` | 所有圖片的完整 CDN URL 陣列（https，含 suffix） |
| `videoUrl` | 影片 URL（僅 video 類型有值） |

> 若 `type == "video"` → 跳過步驟 4，回傳 `localFiles: []`。

### 步驟 4：並行 curl 下載圖片

將步驟 3 回傳的 `imageUrls` 直接傳入下載腳本：

```bash
python3 ~/skills/fetch-xiaohongshu/scripts/download_images.py '$IMAGE_URLS_JSON' /tmp/xhs_img
```

輸出範例（全部成功）：

```
OK 1: 51K
OK 2: 81K
OK 3: 58K
OK 4: 99K
OK 5: 91K
```

**驗證**：若所有行均為 `OK` 且大小 > 10K → **完成，跳過步驟 4C**。

若有 `FAIL`（大小 < 10KB），對失敗的張數用步驟 4C 補抓。

#### 步驟 4C：Canvas 補抓（備用，僅對失敗張數）

> 🚨 **嚴格禁止**：每次 `browser evaluate` 只能回傳**一張**圖片的 base64，否則 tool result 過大導致 context overflow。

對每張需補抓的圖片，**一張一張**執行：

**4C-a. 切換到目標頁（若非第一張）**

**方法一（優先）**：取得 snapshot，找投影片計數器（如 `generic: 1/5`），點擊右側箭頭按鈕：

```
action: click, ref: <右側箭頭的 ref>
```

**方法二（備用）**：Swiper API 直接跳頁（N 為目標頁索引，從 0 開始）：

```bash
openclaw browser evaluate --browser-profile openclaw \
  --fn "() => { const s = document.querySelector('.swiper')?.swiper; s && s.slideTo(N); return s?.realIndex; }"
sleep 1
```

> ⚠️ `sleep 0.5` 不夠：Swiper 動畫 + 圖片載入需要至少 1 秒。

**4C-b. Canvas 擷取 → 存檔**

```bash
openclaw browser evaluate --browser-profile openclaw \
  --fn "$(cat ~/skills/fetch-xiaohongshu/scripts/extract_canvas.js)" \
  | python3 -c "import sys,base64; open('/tmp/xhs_img_N.webp','wb').write(base64.b64decode(sys.stdin.read().strip()))"

ls -lh /tmp/xhs_img_N.webp
```

> ⚠️ 不要用 `base64 -d`，會因換行符號報「輸入無效」。請用 Python `base64.b64decode`。

**4C-c. 重複直到所有失敗張數補抓完畢**

### 步驟 5：回傳結構化資料

```json
{
  "title": "...",
  "author": "...",
  "desc": "...",
  "tags": [...],
  "imageCount": 5,
  "localFiles": ["/tmp/xhs_img_1.webp", ..., "/tmp/xhs_img_5.webp"]
}
```

## 舊版腳本（保留向後相容）

若 `extract_all.js` 因小紅書改版失效，可回退使用分離腳本：

| 腳本 | 用途 |
|------|------|
| `scripts/extract_metadata.js` | 僅萃取 metadata（不含圖片 URL） |
| `scripts/extract_image_urls.js` | 從 DOM img 標籤抓 URL（可能受懶加載影響） |
| `scripts/extract_canvas.js` | Canvas 逐張擷取 base64 |
| `scripts/download_images.sh` | 舊版 bash 下載腳本，已被 `download_images.py` 取代 |

## 特殊情況

| 情況 | 處理方式 |
|------|---------|
| `imageCount == 0` | 純文字貼文，跳過步驟 4，`localFiles: []` |
| `imageCount == 1` | 只擷取一張，不需要點擊切換 |
| `type == "video"` | 不支援影片下載，`localFiles: []`，desc 填入內容 |
| curl 下載後 FAIL | 對失敗張數用步驟 4C Canvas 補抓 |
| Canvas 回傳 `{"error": ...}` | 記錄錯誤，繼續嘗試下一張 |
