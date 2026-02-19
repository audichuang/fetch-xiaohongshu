***

name: fetch-xiaohongshu
description: "Fetch xiaohongshu (小紅書) post content and images using OpenClaw browser with canvas extraction. Returns structured data: title, author, content, tags, and MinIO image URLs. Atomic skill for xiaohongshu extraction. Trigger keywords: 小紅書, xiaohongshu, xhslink, 紅書."
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# Fetch Xiaohongshu — 小紅書擷取原子技能

從小紅書貼文擷取文字內容與圖片，上傳圖片至 MinIO，回傳結構化資料。

> **這是原子技能**：只負責「從小紅書 URL 擷取內容和圖片」，不包含格式化或存入 Obsidian 的邏輯。

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
  "images": ["http://minio/img1.webp", "http://minio/img2.webp"],
  "localFiles": ["/tmp/xhs_img_1.webp", "/tmp/xhs_img_2.webp"]
}
```

> 此技能**不負責**解讀圖片內容或撰寫摘要。圖片讀取與內容整合由呼叫方（編排技能）負責。
> `localFiles` 讓呼叫方可以用 Read 工具視覺讀取每張圖片的原始內容。

## 技術背景

* **為何要用 Canvas 擷取圖片**：小紅書 CDN (`sns-webpic-qc.xhscdn.com`) 無 CORS header，fetch/XHR 會被瀏覽器阻擋；但 CDP 的 `evaluate` 不強制執行 canvas taint policy，已載入的 `<img>` 可直接畫到 canvas 並取得 base64。
* **為何用 openclaw profile**：使用 CDP 直連，不透過 Chrome Extension relay，更穩定可靠。

## 工作流程

### 步驟 1：開啟瀏覽器並導航

使用 browser tool：

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

回傳欄位：

| 欄位 | 說明 |
|------|------|
| `type` | `"normal"`（圖片/文字）或 `"video"` |
| `title` | 貼文標題 |
| `desc` | 文字內容（純文字貼文的正文） |
| `author` | 作者暱稱 |
| `tags` | 標籤陣列 |
| `imageCount` | 圖片數量（0 = 純文字貼文） |

> 若 `type == "video"` → 目前不支援圖片擷取，直接跳到步驟 6 回傳 desc 即可。

### 步驟 4：逐張擷取圖片（Canvas 方式）

對每張圖片（共 `imageCount` 張）執行：

**4a. Canvas 擷取 → 存檔**

```bash
RESULT=$(openclaw browser evaluate --browser-profile openclaw \
  --fn "$(cat ~/skills/fetch-xiaohongshu/scripts/extract_canvas.js)")
echo "$RESULT" | base64 -d > /tmp/xhs_img_N.webp
```

將 `N` 替換為當前圖片序號（1, 2, 3...）。

**4b. 切換到下一張（若還有下一張）**

取得 snapshot，找投影片計數器（如 `generic: 1/5`），點擊計數器**右側**的箭頭按鈕：

```
action: click, ref: <右側箭頭的 ref>
```

> 投影片區通常有兩個箭頭（上一張/下一張），選計數器右側那個。

**4c. 重複 4a + 4b 直到所有 `imageCount` 張擷取完畢**

### 步驟 5：上傳圖片到 MinIO

```bash
doppler run -p minio -c dev -- python3 ~/skills/uploading-to-minio/scripts/upload_file.py \
  /tmp/xhs_img_1.webp /tmp/xhs_img_2.webp \
  --prefix "xiaohongshu/$(date +%Y-%m-%d)"
```

回傳 JSON 陣列，提取每個物件的 `url` 欄位。

### 步驟 6：回傳結構化資料

整合步驟 3 的 metadata + 步驟 5 的圖片 URL，回傳：

```json
{
  "title": "...",
  "author": "...",
  "desc": "...",
  "tags": [...],
  "imageCount": 5,
  "images": ["http://minio/...", ...],
  "localFiles": ["/tmp/xhs_img_1.webp", "/tmp/xhs_img_2.webp", ...]
}
```

`localFiles` 為本機暫存路徑，呼叫方可用 `Read` 工具讀取圖片內容。

## 特殊情況

| 情況 | 處理方式 |
|------|---------|
| `imageCount == 0` | 純文字貼文，跳過步驟 4+5，images 回傳 `[]` |
| `imageCount == 1` | 只擷取一張，不需要點擊切換 |
| `type == "video"` | 不支援圖片擷取，images 回傳 `[]`，content 填 desc |
| Canvas 回傳 `{"error": ...}` | 記錄錯誤，繼續嘗試下一張 |
