---
name: fetch-xiaohongshu
description: "Fetch xiaohongshu (小紅書) post content and images using OpenClaw browser. Fast path: parallel curl from img.currentSrc (~1 sec for 22 imgs). Fallback: canvas extraction per image. Returns structured data: title, author, desc, tags, and local image file paths. Does NOT upload to MinIO. Atomic skill for xiaohongshu extraction. Trigger keywords: 小紅書, xiaohongshu, xhslink, 紅書."
---

# Fetch Xiaohongshu — 小紅書擷取原子技能

從小紅書貼文擷取文字 metadata 與圖片，將圖片存至本機暫存，回傳結構化資料。

> **這是原子技能**：只負責「抓取」——metadata 萃取 + 圖片下載到本機（優先 curl 並行，備用 Canvas）。
> **不負責**：圖片讀取解析、MinIO 上傳、內容整合、存入 Obsidian。

## 輸入

* `url`: 小紅書分享連結（`xiaohongshu.com` 或 `xhslink.com`）

## 輸出

```json
{
  "title": "貼文標題",
  "author": "作者名稱",
  "desc": "貼文說明文字（__INITIAL_STATE__ 的 desc 欄位）",
  "tags": ["標籤1", "標籤2"],
  "imageCount": 5,
  "localFiles": ["/tmp/xhs_img_1.webp", "/tmp/xhs_img_2.webp", "..."]
}
```

> `localFiles` 為本機暫存路徑，呼叫方（編排技能）負責讀取圖片內容與上傳。

## 技術背景

* **快速路徑（curl）**：`img.currentSrc` 的完整 CDN URL（含 `!nd_dft_wlteh_webp_3` suffix）可直接 curl 下載，只需 `Referer` + `User-Agent` header，不需 cookie。22 張並行 ~0.5-1 秒（vs 舊 Canvas 55 秒）。
* **⚠️ URL 來源**：必須用 `img.currentSrc`（含 suffix）；`__INITIAL_STATE__` 的 URL 去掉 suffix 後會 403。
* **備用路徑（Canvas）**：小紅書 CDN 無 CORS header，fetch/XHR 被瀏覽器阻擋；但 CDP `evaluate` 不強制 canvas taint policy，已載入的 `<img>` 可直接畫到 canvas 取得 base64。
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

### 步驟 3：萃取貼文元資料

```bash
openclaw browser evaluate --browser-profile openclaw \
  --fn "$(cat ~/skills/fetch-xiaohongshu/scripts/extract_metadata.js)"
```

| 欄位 | 說明 |
|------|------|
| `type` | `"normal"` 或 `"video"` |
| `title` | 貼文標題 |
| `desc` | 說明文字 |
| `author` | 作者暱稱 |
| `tags` | 標籤陣列 |
| `imageCount` | 圖片數量（0 = 純文字貼文） |

> 若 `type == "video"` → 跳過步驟 4，回傳 `localFiles: []`。

### 步驟 4：擷取圖片（快速路徑 curl → 備用 Canvas）

#### 步驟 4A：取得 URL 陣列（僅字串，極小）

```bash
openclaw browser evaluate --browser-profile openclaw \
  --fn "$(cat ~/skills/fetch-xiaohongshu/scripts/extract_image_urls.js)"
```

回傳 JSON 陣列，例如：
```json
["https://sns-webpic-qc.xhscdn.com/.../photo_1!nd_dft_wlteh_webp_3", "..."]
```

> 若回傳的 URL 數量少於 `imageCount`，表示部分圖片尚未載入（在輪播後方）。此時先用已有 URL 下載，再對缺少的張數用步驟 4C Canvas 補抓。

#### 步驟 4B：並行 curl 下載（快速路徑，~0.5-1 秒）

將步驟 4A 的 JSON 陣列存為 `URLS` 變數，執行：

```bash
bash ~/skills/fetch-xiaohongshu/scripts/download_images.sh '$URLS' /tmp/xhs_img
```

輸出範例（全部成功）：
```
OK 1: 87K
OK 2: 93K
OK 3: 71K
...
```

**驗證**：若所有行均為 `OK` 且大小 > 10K → **完成，跳過步驟 4C**。

若有 `FAIL`（大小 < 10KB），記錄失敗的序號，對這些圖用步驟 4C 補抓。

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

## 特殊情況

| 情況 | 處理方式 |
|------|---------|
| `imageCount == 0` | 純文字貼文，跳過步驟 4，`localFiles: []` |
| `imageCount == 1` | 只擷取一張，不需要點擊切換 |
| `type == "video"` | 不支援，`localFiles: []`，desc 填入內容 |
| curl 下載後 FAIL | 對失敗張數用步驟 4C Canvas 補抓 |
| 4A 回傳 URL 少於 imageCount | 先下載已有 URL，缺少的張數滾動輪播後再跑 4A 或用 4C 補 |
| Canvas 回傳 `{"error": ...}` | 記錄錯誤，繼續嘗試下一張 |
