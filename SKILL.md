---
name: fetch-xiaohongshu
description: "Fetch xiaohongshu (小紅書) post content and images using OpenClaw browser with canvas extraction. Returns structured data: title, author, desc, tags, and local image file paths. Does NOT upload to MinIO. Atomic skill for xiaohongshu extraction. Trigger keywords: 小紅書, xiaohongshu, xhslink, 紅書."
---

# Fetch Xiaohongshu — 小紅書擷取原子技能

從小紅書貼文擷取文字 metadata 與圖片，將圖片存至本機暫存，回傳結構化資料。

> **這是原子技能**：只負責「抓取」——metadata 萃取 + Canvas 圖片下載到本機。
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

* **為何用 Canvas 擷取圖片**：小紅書 CDN (`sns-webpic-qc.xhscdn.com`) 無 CORS header，fetch/XHR 被瀏覽器阻擋；但 CDP `evaluate` 不強制 canvas taint policy，已載入的 `<img>` 可直接畫到 canvas 取得 base64。
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

### 步驟 4：逐張擷取圖片（Canvas → 本機存檔）

> 🚨 **嚴格禁止**：不可用一個 JS 一次回傳多張圖片的 base64（例如 async loop 回傳陣列）。
> 每次 `browser evaluate` 只能回傳**一張**圖片的 base64，否則 tool result 過大會導致 context overflow，整個 session 被 terminate。

對每張圖片（共 `imageCount` 張），**一張一張**執行完整循環：

**4a. Canvas 擷取當前這張 → 用 exec 存檔**

```bash
# 1. evaluate 只回傳當前這一張的 base64，立刻用 Python 解碼存檔
openclaw browser evaluate --browser-profile openclaw \
  --fn "$(cat ~/skills/fetch-xiaohongshu/scripts/extract_canvas.js)" \
  | python3 -c "import sys,base64; open('/tmp/xhs_img_N.webp','wb').write(base64.b64decode(sys.stdin.read().strip()))"

# 2. 驗證（只看 size，不印出 base64）
ls -lh /tmp/xhs_img_N.webp
```

> ⚠️ 不要用 `base64 -d`，會因換行符號報「輸入無效」。請用 Python `base64.b64decode` 解碼。

將 `N` 替換為當前圖片序號（1, 2, 3...）。

**4b. 切換到下一張（若還有下一張）**

**方法一（優先）**：取得 snapshot，找投影片計數器（如 `generic: 1/5`），點擊計數器右側的箭頭按鈕：

```
action: click, ref: <右側箭頭的 ref>
```

**方法二（備用，若方法一無效）**：用 Swiper API 直接跳頁（N 為目標頁，從 0 開始）：

```bash
openclaw browser evaluate --browser-profile openclaw \
  --fn "() => { const s = document.querySelector('.swiper')?.swiper; s && s.slideTo(N); return s?.realIndex; }"
```

> 判斷是否成功切換：下次 canvas 擷取的圖片檔案大小應與上一張**不同**。若大小相同，表示仍是同一張，需再嘗試切換。

**4c. 重複 4a + 4b 直到所有 `imageCount` 張擷取完畢**

> 每張圖約 60-110KB，13 張全部一起回傳 ≈ 1.3MB base64 → context 爆炸。**一定要一張一張來。**

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
| Canvas 回傳 `{"error": ...}` | 記錄錯誤，繼續嘗試下一張 |
