# 點名 - 離線 AI 人臉辨識與團隊點名系統 (list.daliuren.cc)

高度優化於 **iPhone 13 Pro (iOS Safari / PWA)** 執行的 100% 離線國外旅遊點名與團隊管理系統。專為 30 人以內之團體旅遊設計，整合 **離線 AI 人臉辨識引擎 (128維特徵向量)**、**雙引擎遠距離相機縮放 (1.0x ~ 4.0x)**、**自訂點名群組管理**、**防重複註冊**與**一鍵複製點名紀錄**等強大功能。

---

## 🌟 系統核心特色

### 1. 🤖 100% 離線 AI 人臉辨識與實時診斷
- **離線人臉特徵提取**：採用 `face-api.js` (TinyFaceDetectorOptions 離線模型權重)，在無網路（飛航模式）下即時掃描人臉並分析 128 維特徵碼。
- **歐氏距離實時比對**：提供即時比對診斷日誌，動態顯示目前比對距離與合格門檻（例：`[✓ 比對成功: 王小明 (歐氏距離 0.42 <= 0.65)]`）。
- **綠色/紅色動態追蹤框**：辨識成功自動標示綠色實名外框並發出提示音與成功卡片動畫，防止重複打勾。

### 2. 🔍 雙引擎遠距離相機變焦 (Hardware + Digital Zoom Engine)
- **1.0x ~ 4.0x 縮放控制**：結合手機鏡頭硬體變焦 (`MediaTrackConstraints.zoom`) 與高解析度數位放大 (`CSS transform: scale()`)，可將 3 ~ 5 公尺外的遠距離團員臉孔放大進行 AI 點名。
- **2 層式響應式控制面板**：提供 **`[ 1x ]`** ‧ **`[ 1.5x ]`** ‧ **`[ 2x ]`** ‧ **`[ 3x ]`** 倍率快捷按鈕與平滑滑桿。
- **後置鏡頭預設與控制**：開啟相機預設調用後置主鏡頭 (`facingMode: 'environment'`)，提供 **`🔄 切換鏡頭`**、**`⚡ 重新整理鏡頭`** 與 **`🚫 關閉鏡頭`** 功能。

### 3. 🎯 自訂點名群組管理系統 (新增 / 編輯群組名稱 / 成員分組)
- **多功能群組管理**：支援建立自訂行程群組（例如：`遊覽車A車`、`景點自由行B組`、`晚餐第一桌`）。
- **群組編輯與重新命名**：提供 **`✏️ 編輯`** 按鈕，可隨時修改群組名稱或更新該群組的勾選成員。
- **秒速套用與切換**：點擊任意群組膠囊，點名看板立即切換為該群組成員名單，滿足多元點名需求。

### 4. 📝 彈性團員註冊機制 (預先建立 + AI 特徵追加)
- **免相機預先打字建名冊**：出發前無需開啟相機，輸入姓名即可直接新增無特徵碼的團員卡片（支援手動點名）。
- **防重複名冊建立**：自動檢測團員姓名，若同名團員已存在且相機開啟，自動為該團員追加多筆 AI 人臉特徵向量，大幅提升多角度辨識準確率。

### 5. 📱 極簡質感 UI 與 PWA 離線架構 (v6)
- **iOS 主畫面專屬 App**：主畫面 APP 名稱設為 **「點名」**，搭配質感升級之 **「點」** 字圖示與專屬 `apple-touch-icon.png`。
- **雙重區塊摺疊功能**：相機預覽區塊與團員總名冊均配備 **`[ 🔼 收起 / 🔽 展開 ]`** 按鈕，釋放手機全螢幕空間予點名看板。
- **100% Cache-First 離線快取**：`service-worker.js` (v6) 確保斷網環境下載入速度秒開。

---

## 🗄️ IndexedDB 本地資料庫架構 (Version 6)

專案採用瀏覽器 IndexedDB 本地極速儲存，完全免用伺服器或外部分頁：

- `members`：儲存團員 ID、姓名、特徵向量陣列 (`descriptors: Array<Float32Array>`)、快照頭像。
- `attendance`：儲存每日點名紀錄（團員 ID、日期、打卡時間、打卡類型 `ai` 或 `tap`）。
- `groups`：儲存自訂群組（群組 ID、群組名稱 `name`、成員 ID 陣列 `memberIds`）。

---

## 📁 專案目錄結構

```
d:\website\list\
├── index.html              # 主介面與 PWA App Shell
├── manifest.json           # PWA 應用程式配置 (Short Name: "點名")
├── service-worker.js       # PWA v6 離線快取 Service Worker
├── README.md               # 專案說明文件
├── css/
│   ├── tailwind.min.css    # Tailwind CSS 核心樣式檔
│   └── custom.css          # 暗黑主題、iOS Safe-Area 與鏡頭動畫
├── js/
│   ├── face-api.min.js     # 離線人臉辨識庫
│   └── app.js              # 應用程式核心 logic、IndexedDB 與 AI 引擎
├── models/                 # AI 人臉辨識權重檔
│   ├── tiny_face_detector_model-weights_manifest.json
│   ├── face_landmark_68_tiny_model-weights_manifest.json
│   └── face_recognition_model-weights_manifest.json
└── assets/                 # App Icon 與 iOS 主畫面圖示
    ├── icon.svg            # 高畫質 SVG 圖檔
    ├── apple-touch-icon.png# iOS Safari 主畫面圖示 (180x180)
    ├── icon-192.png        # PWA Icon (192x192)
    └── icon-512.png        # PWA Icon (512x512)
```

---

## 🚀 本地開發與測試

使用任何 HTTP 靜態伺服器開啟專案根目錄：

```bash
# 使用 Python 開啟
python -m http.server 8080

# 或使用 Node.js http-server
npx http-server ./ -p 8080
```

瀏覽器訪問 `http://localhost:8080` 即可測試全套離線功能。

---

## 🌐 正式環境部署 (list.daliuren.cc)

專案原始碼已託管於 GitHub：  
👉 **[https://github.com/stevecjs/list-web.git](https://github.com/stevecjs/list-web.git)**

正式網站網址：  
👉 **[https://list.daliuren.cc](https://list.daliuren.cc)**

> **iOS 使用者建議**：在 iPhone 13 Pro Safari 開啟網頁後，點擊底部「分享」按鈕並選擇**「加入主畫面」**，即可獲得 100% 離線、無網址列的全螢幕原生 App 點名體驗！
