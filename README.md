# 點 - 離線點名與註冊系統 (list.daliuren.cc)

高度優化於 **iPhone 13 Pro (iOS Safari / PWA)** 執行的 100% 離線國外旅遊點名與成員管理系統。專為 30 人以內之團體旅遊設計，具備強大離線快取、照片頭像註冊、一鍵點名看板、動態挑選對象與點名紀錄複製功能。

---

## 🌟 系統核心特色

1. **100% 完全離線 (PWA 架構)**：
   - 專屬 App 標籤名稱為 **「點」**。
   - `service-worker.js` (v4) 使用 Cache-First 快取策略，在完全沒有網路（飛航模式）下開機並順暢運行。

2. **零模組依賴獨立引擎 (100% 設備相容)**：
   - 採用原生單一封裝架構，無跨檔案 ES Module 載入卡關風險，在舊款 iOS Safari 與各類手機瀏覽器上皆可秒速載入。

3. **相片頭像快速註冊與秒速點名**：
   - 相機支援前後鏡頭切換 (`user` / `environment`)。
   - 輸入姓名即可一鍵拍攝頭像圖片並寫入 IndexedDB 本地資料庫。
   - 提供大字體高對比團員卡片，點擊卡片即可發出提示音並完成手動/即時點名。

4. **動態用途/行程挑選點名對象 (🎯 挑選對象)**：
   - 不受限於固定分組，提供「全選」、「全不選」與「自訂挑選」抽屜視窗。
   - 可依不同旅遊行程（例：遊覽車上點名 15 人、晚餐集合 10 人）自由挑選點名名冊。

5. **一鍵清空點名看板 (🧹 清空看板)**：
   - 一鍵將看板紀錄重置為「未出席」狀態，方便前往下一個景點時開啟新一輪點名。

6. **一鍵複製點名紀錄至剪貼簿 (📋 複製紀錄)**：
   - 自動生成包含「已出席名單 (含點名時間)」與「未出席名單」之排版文字，可直接貼上至 LINE 或微信群組。

7. **一鍵強制更新 PWA 網頁 (🔄 更新網頁)**：
   - 提供硬體快取清除按鈕，秒速清空離線快取並載入最新版網站（團員資料安全保留）。

8. **高對比暗黑介面設計 (High Contrast Dark Mode)**：
   - 針對 iOS Safari 淺色模式控制項進行強制暗黑覆蓋 (`color-scheme: dark !important;`)，確保輸入框、按鈕與卡片文字清晰可見。

---

## 📁 專案結構

```
d:\website\list\
├── index.html              # 主介面與 PWA App Shell
├── manifest.json           # Web App Manifest 配置 (Short Name: "點")
├── service-worker.js       # PWA v4 離線 Service Worker
├── README.md
├── .gitignore
├── css/
│   ├── tailwind.min.css    # Tailwind CSS 核心樣式檔
│   └── custom.css          # 高對比主題、iOS Safe-Area 與動畫
├── js/
│   └── app.js              # 單一獨立應用程式核心邏輯與 IndexedDB 引擎
└── assets/                 # PWA App Icon 圖標與資源 (icon.svg, icon-192, icon-512)
```

---

## 🚀 快速啟動與本地測試

使用本地 HTTP 伺服器開啟本專案：

```bash
# 使用 Node.js http-server
npx http-server ./ -p 8080

# 或使用 Python
python -m http.server 8080
```

瀏覽器開啟 `http://localhost:8080` 即可進行測試。

---

## 🌐 正式部署 (list.daliuren.cc)

本專案已被上傳並部署至 GitHub 儲存庫：  
**https://github.com/stevecjs/list-web.git**

正式域名部署於 **`https://list.daliuren.cc`**。

*注意：iOS Safari 必須在 HTTPS 環境下才允許存取相機權限與安裝 PWA 主畫面小圖標。*
