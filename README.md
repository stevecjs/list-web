# list - 離線人臉辨識點名與註冊系統 (list.daliuren.cc)

高度優化於 **iPhone 13 Pro (iOS Safari / PWA)** 執行的 100% 離線人臉辨識與即時點名系統。專為 30 人以內之國外旅遊團體設計，無需網路即可實現即時人臉特徵提取、歐氏距離比對、時間戳記寫入與 CSV 紀錄匯出。

## 🌟 系統亮點

1. **100% 完全離線 (PWA)**：
   - 內建 `face-api.js` 與 Tiny Face Detector / Landmark / Recognition 離線模型權重檔。
   - `service-worker.js` 使用 Cache-First 策略預快取所有靜態資源與模型檔，支援飛航模式下開機並流暢運行。
2. **iOS Safari / iPhone 13 Pro 專屬優化**：
   - 相機 `<video>` 標籤配置 `autoplay`, `playsinline`, `muted` 確保 Safari 相機流暢開鎖。
   - Web Audio API 離線合成音效，完美繞過 iOS 靜音模式播放限制。
3. **IndexedDB 離線資料庫**：
   - 儲存成員姓名、臉部 128 維特徵向量 (`Float32Array`) 及點名歷史紀錄。
4. **即時比對與防重複點名**：
   - 0.52 歐氏距離閥值精準辨識，匹配成功發出提示音與視覺提示，並自動啟動 1.5 秒個人冷卻防止重複紀錄。
   - 提供實時看板（紅綠標記）及手動點擊補點名備用機制。
5. **本地 CSV 數據匯出**：
   - 帶 UTF-8 BOM (`\uFEFF`) 標準編碼，點擊按鈕即可下載可直接在 iPhone Excel / Numbers 打開的點名表。

---

## 📁 專案結構

```
d:\website\list\
├── index.html              # 主介面與 PWA App Shell
├── manifest.json           # Web App Manifest 配置 (iOS PWA)
├── service-worker.js       # PWA 離線快取的 Service Worker
├── README.md
├── .gitignore
├── css/
│   ├── tailwind.min.css    # 離線 Tailwind CSS
│   └── custom.css          # iOS 佈局、玻璃擬態與辨識動畫
├── js/
│   ├── face-api.min.js     # 離線 Face API 辨識引擎
│   ├── db.js               # IndexedDB 封裝模組
│   ├── sound.js            # Web Audio API 音效合成器
│   └── app.js              # 主邏輯、相機控制與點名流程
├── models/                 # 人臉辨識離線權重檔
└── assets/                 # App 圖標與資源
```

---

## 🚀 快速啟動與本地測試

由於本專案為全前端純靜態網頁（含有 Service Worker 與 ES Modules），請使用本地 HTTP 伺服器開啟：

```bash
# 方法一：使用 Node.js http-server
npx http-server ./ -p 8080

# 方法二：使用 Python
python -m http.server 8080
```

瀏覽器開啟 `http://localhost:8080` 即可進行測試。

---

## 🌐 正式部署 (list.daliuren.cc)

將本專案目錄下所有檔案直接上傳/部署至您的 Web 伺服器 (如 Cloudflare Pages, GitHub Pages, Vercel 或 Nginx)，並綁定 SSL 證書（HTTPS）即可。  
*注意：iOS Safari 必須在 HTTPS 環境下才允許開啟 getUserMedia 相機權限與 PWA 功能。*
