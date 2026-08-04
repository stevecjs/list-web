/**
 * app.js - Main Application Logic
 * Offline Face Recognition Attendance System for list.daliuren.cc
 */

import {
  initDB,
  getAllMembers,
  addMember,
  deleteMember,
  getAttendanceByDate,
  getAllAttendance,
  markAttendance,
  toggleManualAttendance,
  clearAllData
} from './db.js';

import { initAudio, playBeepSound, playErrorSound } from './sound.js';

// Configuration & State
const CONFIG = {
  MODEL_URL: './models',
  FACE_DISTANCE_THRESHOLD: 0.52, // Euclidean distance threshold (lower = stricter)
  COOLDOWN_MS: 1500,             // Cooldown to prevent duplicate check-ins
  DETECTION_INTERVAL_MS: 100     // Camera scan tick rate (~10 FPS on mobile for efficiency)
};

let currentTab = 'scan';
let isModelLoaded = false;
let isScanning = false;
let isRegistering = false;
let stream = null;
let faceMatcher = null;
let registeredMembers = [];
let todayAttendance = [];
let scanIntervalId = null;
let cooldownMap = new Map(); // memberId -> timestamp when cooldown ends

// DOM Elements
const elements = {
  // Navigation
  tabButtons: document.querySelectorAll('.nav-tab'),
  tabContents: document.querySelectorAll('.tab-content'),
  
  // Header & Status
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  dateDisplay: document.getElementById('date-display'),

  // Scan View
  scanVideo: document.getElementById('scan-video'),
  scanCanvas: document.getElementById('scan-canvas'),
  startScanBtn: document.getElementById('btn-start-scan'),
  switchCameraBtn: document.getElementById('btn-switch-camera'),
  scanSuccessBanner: document.getElementById('scan-success-banner'),
  bannerName: document.getElementById('banner-name'),
  bannerTime: document.getElementById('banner-time'),
  presentCount: document.getElementById('present-count'),
  totalCount: document.getElementById('total-count'),
  boardMemberList: document.getElementById('board-member-list'),

  // Register View
  regNameInput: document.getElementById('reg-name-input'),
  regVideo: document.getElementById('reg-video'),
  regCanvas: document.getElementById('reg-canvas'),
  startRegCameraBtn: document.getElementById('btn-start-reg-camera'),
  captureFaceBtn: document.getElementById('btn-capture-face'),
  regStatusMsg: document.getElementById('reg-status-msg'),
  registeredMemberList: document.getElementById('registered-member-list'),

  // Logs View
  logDateInput: document.getElementById('log-date-input'),
  exportCsvBtn: document.getElementById('btn-export-csv'),
  logsTableBody: document.getElementById('logs-table-body'),

  // Settings View
  clearDataBtn: document.getElementById('btn-clear-data'),
  thresholdInput: document.getElementById('threshold-input'),
  thresholdValue: document.getElementById('threshold-value')
};

let currentFacingMode = 'user'; // 'user' or 'environment'

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupEventListeners();
  updateClock();
  setInterval(updateClock, 1000);

  // Set default date picker to today
  const todayStr = getTodayDateStr();
  if (elements.logDateInput) elements.logDateInput.value = todayStr;

  // Register Service Worker for PWA Offline Support
  registerServiceWorker();

  // Load IndexedDB Data
  await refreshMembersAndMatcher();
  await refreshTodayAttendance();

  // Load Face API Models
  await loadFaceModels();
});

// Register Service Worker
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => console.log('Service Worker Registered:', reg.scope))
      .catch(err => console.error('Service Worker Registration Failed:', err));
  }
}

// Load Face API Models from local ./models directory
async function loadFaceModels() {
  updateStatus('載入人臉模組中...', 'yellow');
  try {
    // Make sure faceapi is loaded
    if (typeof faceapi === 'undefined') {
      throw new Error('face-api.js Script 未載入');
    }

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(CONFIG.MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(CONFIG.MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(CONFIG.MODEL_URL)
    ]);

    isModelLoaded = true;
    updateStatus('人臉辨識引擎就緒 (離線模式)', 'green');
    console.log('Face models successfully loaded from local directory.');
  } catch (err) {
    console.error('Failed to load face models:', err);
    updateStatus('模型載入失敗，請重新整理', 'red');
  }
}

// Status Bar Updater
function updateStatus(text, color = 'green') {
  if (!elements.statusText) return;
  elements.statusText.textContent = text;
  const colorMap = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500'
  };
  elements.statusDot.className = `w-2.5 h-2.5 rounded-full ${colorMap[color] || 'bg-gray-400'}`;
}

function getTodayDateStr() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function updateClock() {
  if (!elements.dateDisplay) return;
  const now = new Date();
  elements.dateDisplay.textContent = `${now.toLocaleDateString('zh-TW')} ${now.toLocaleTimeString('zh-TW')}`;
}

// Tab Switching
function setupTabs() {
  elements.tabButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      initAudio(); // User gesture initializes Web Audio API
      const targetTab = btn.dataset.tab;
      switchTab(targetTab);
    });
  });
}

async function switchTab(tabName) {
  currentTab = tabName;
  elements.tabButtons.forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('nav-tab-active', 'text-sky-400');
      btn.classList.remove('text-gray-400');
    } else {
      btn.classList.remove('nav-tab-active', 'text-sky-400');
      btn.classList.add('text-gray-400');
    }
  });

  elements.tabContents.forEach(content => {
    content.classList.toggle('hidden', content.id !== `tab-${tabName}`);
  });

  // Stop camera when leaving camera tabs
  if (tabName !== 'scan' && tabName !== 'register') {
    stopCamera();
  }

  if (tabName === 'scan') {
    await refreshTodayAttendance();
  } else if (tabName === 'register') {
    renderRegisteredMemberList();
  } else if (tabName === 'logs') {
    renderLogsTable();
  }
}

// Camera Controls
async function startCamera(videoElement, facingMode = 'user') {
  try {
    stopCamera();
    const constraints = {
      video: {
        facingMode: facingMode,
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = stream;
    
    return new Promise((resolve) => {
      videoElement.onloadedmetadata = () => {
        videoElement.play();
        resolve(true);
      };
    });
  } catch (err) {
    console.error('Camera access error:', err);
    alert('無法存取相機，請確認 Safari 相機權限設定。');
    return false;
  }
}

function stopCamera() {
  if (scanIntervalId) {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
  }
  isScanning = false;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  if (elements.scanVideo) elements.scanVideo.srcObject = null;
  if (elements.regVideo) elements.regVideo.srcObject = null;
}

// Refresh Members & Build FaceMatcher
async function refreshMembersAndMatcher() {
  registeredMembers = await getAllMembers();
  if (registeredMembers.length === 0) {
    faceMatcher = null;
    return;
  }

  const labeledDescriptors = registeredMembers.map(m => {
    const floatArray = new Float32Array(m.descriptor);
    return new faceapi.LabeledFaceDescriptors(m.id, [floatArray]);
  });

  faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, CONFIG.FACE_DISTANCE_THRESHOLD);
}

// Refresh Attendance & Update Board UI
async function refreshTodayAttendance() {
  const today = getTodayDateStr();
  todayAttendance = await getAttendanceByDate(today);

  // Update counters
  elements.presentCount.textContent = todayAttendance.length;
  elements.totalCount.textContent = registeredMembers.length;

  renderBoardMemberList();
}

// Render Attendance Status Board
function renderBoardMemberList() {
  const container = elements.boardMemberList;
  if (!container) return;

  if (registeredMembers.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-8 text-center text-gray-500 text-sm">
        尚未註冊成員，請先至「成員註冊」頁面新增團員資料。
      </div>
    `;
    return;
  }

  const attendedSet = new Map();
  todayAttendance.forEach(a => attendedSet.set(a.memberId, a));

  container.innerHTML = registeredMembers.map(member => {
    const isPresent = attendedSet.has(member.id);
    const attRecord = attendedSet.get(member.id);

    return `
      <div 
        data-member-id="${member.id}"
        class="manual-toggle-card cursor-pointer p-3 rounded-xl flex items-center justify-between transition-all duration-200 ${
          isPresent ? 'bg-emerald-950/40 border border-emerald-500/40' : 'bg-slate-800/50 border border-slate-700/50'
        }"
      >
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-full overflow-hidden bg-slate-700 flex-shrink-0 flex items-center justify-center font-bold text-slate-300">
            ${member.photoDataUrl ? `<img src="${member.photoDataUrl}" class="w-full h-full object-cover" />` : member.name.charAt(0)}
          </div>
          <div>
            <div class="font-medium text-slate-200">${member.name}</div>
            <div class="text-xs ${isPresent ? 'text-emerald-400' : 'text-slate-400'}">
              ${isPresent ? `已到 ‧ ${attRecord.timeStr} (${attRecord.type === 'manual' ? '手動' : '人臉'})` : '未到'}
            </div>
          </div>
        </div>
        <div class="px-2.5 py-1 rounded-full text-xs font-semibold ${
          isPresent ? 'badge-present' : 'badge-absent'
        }">
          ${isPresent ? '✓ 已出席' : '未出席'}
        </div>
      </div>
    `;
  }).join('');

  // Add click handler for manual check-in toggle
  container.querySelectorAll('.manual-toggle-card').forEach(card => {
    card.addEventListener('click', async () => {
      const id = card.dataset.memberId;
      const member = registeredMembers.find(m => m.id === id);
      if (member) {
        initAudio();
        await toggleManualAttendance(member.id, member.name, getTodayDateStr());
        playBeepSound();
        await refreshTodayAttendance();
      }
    });
  });
}

// REAL-TIME FACE ATTENDANCE SCANNING
async function startAttendanceScan() {
  if (!isModelLoaded) {
    alert('人臉辨識模組載入中，請稍候...');
    return;
  }

  initAudio();

  const success = await startCamera(elements.scanVideo, currentFacingMode);
  if (!success) return;

  isScanning = true;
  elements.startScanBtn.classList.add('hidden');
  elements.switchCameraBtn.classList.remove('hidden');

  const video = elements.scanVideo;
  const canvas = elements.scanCanvas;

  scanIntervalId = setInterval(async () => {
    if (!isScanning || video.paused || video.ended) return;

    // Set canvas internal resolution to match video
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const options = new faceapi.TinyFaceOptions({ inputSize: 224, scoreThreshold: 0.5 });
    const detections = await faceapi.detectAllFaces(video, options)
      .withFaceLandmarks(true)
      .withFaceDescriptors();

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (detections.length === 0) return;

    // Rescale detections to canvas size
    const resizedDetections = faceapi.resizeResults(detections, { width: canvas.width, height: canvas.height });

    for (const detection of resizedDetections) {
      const box = detection.detection.box;
      
      let label = '未登記成員';
      let isMatched = false;
      let matchedMember = null;

      if (faceMatcher && registeredMembers.length > 0) {
        const bestMatch = faceMatcher.findBestMatch(detection.descriptor);
        if (bestMatch.label !== 'unknown') {
          matchedMember = registeredMembers.find(m => m.id === bestMatch.label);
          if (matchedMember) {
            label = matchedMember.name;
            isMatched = true;
          }
        }
      }

      // Draw bounding box
      ctx.lineWidth = 3;
      ctx.strokeStyle = isMatched ? '#10b981' : '#f43f5e';
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      // Draw Label Tag
      ctx.fillStyle = isMatched ? 'rgba(16, 185, 129, 0.85)' : 'rgba(244, 63, 94, 0.85)';
      ctx.fillRect(box.x, box.y - 28, Math.max(100, box.width), 28);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(label, box.x + 8, box.y - 8);

      // Trigger Attendance Logic if matched
      if (isMatched && matchedMember) {
        const nowMs = Date.now();
        const cooldownUntil = cooldownMap.get(matchedMember.id) || 0;

        if (nowMs > cooldownUntil) {
          // Set 1.5s Cooldown to prevent repeating sound & logs
          cooldownMap.set(matchedMember.id, nowMs + CONFIG.COOLDOWN_MS);

          // Write attendance to DB
          const result = await markAttendance(matchedMember.id, matchedMember.name, getTodayDateStr(), 'face');

          if (!result.alreadyCheckedIn) {
            playBeepSound();
            showSuccessBanner(matchedMember.name, result.record.timeStr);
            await refreshTodayAttendance();
          }
        }
      }
    }
  }, CONFIG.DETECTION_INTERVAL_MS);
}

// Show Attendance Banner
function showSuccessBanner(name, timeStr) {
  elements.bannerName.textContent = name;
  elements.bannerTime.textContent = timeStr;
  elements.scanSuccessBanner.classList.remove('hidden');

  setTimeout(() => {
    elements.scanSuccessBanner.classList.add('hidden');
  }, 2200);
}

// MEMBER REGISTRATION MODULE
async function startRegistrationCamera() {
  initAudio();
  const success = await startCamera(elements.regVideo, 'user');
  if (success) {
    elements.startRegCameraBtn.classList.add('hidden');
    elements.captureFaceBtn.classList.remove('hidden');
    elements.regStatusMsg.textContent = '請面對鏡頭，保持光線充足。';
    elements.regStatusMsg.className = 'text-sm text-sky-400 text-center';
  }
}

async function captureAndRegisterFace() {
  const name = elements.regNameInput.value.trim();
  if (!name) {
    alert('請先輸入團員姓名');
    elements.regNameInput.focus();
    return;
  }

  if (!isModelLoaded) {
    alert('人臉辨識模組載入中，請稍候...');
    return;
  }

  elements.captureFaceBtn.disabled = true;
  elements.regStatusMsg.textContent = '分析特徵中，請保持不動...';

  try {
    const video = elements.regVideo;
    const options = new faceapi.TinyFaceOptions({ inputSize: 320, scoreThreshold: 0.5 });
    const detection = await faceapi.detectSingleFace(video, options)
      .withFaceLandmarks(true)
      .withFaceDescriptor();

    if (!detection) {
      playErrorSound();
      elements.regStatusMsg.textContent = '❌ 未能清晰偵測到人臉，請重新對準鏡頭';
      elements.regStatusMsg.className = 'text-sm text-rose-400 text-center';
      elements.captureFaceBtn.disabled = false;
      return;
    }

    // Capture static photo preview
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    
    // Crop center square
    const minDim = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - minDim) / 2;
    const sy = (video.videoHeight - minDim) / 2;
    ctx.drawImage(video, sx, sy, minDim, minDim, 0, 0, 160, 160);
    const photoDataUrl = canvas.toDataURL('image/jpeg', 0.8);

    // Save to IndexedDB
    await addMember({
      name: name,
      descriptor: Array.from(detection.descriptor),
      photoDataUrl: photoDataUrl
    });

    playBeepSound();
    elements.regStatusMsg.textContent = `✓ 團員「${name}」註冊成功！`;
    elements.regStatusMsg.className = 'text-sm text-emerald-400 text-center font-semibold';
    elements.regNameInput.value = '';

    // Rebuild FaceMatcher & lists
    await refreshMembersAndMatcher();
    renderRegisteredMemberList();

  } catch (err) {
    console.error('Face capture error:', err);
    elements.regStatusMsg.textContent = '❌ 註冊失敗，請重試';
  } finally {
    elements.captureFaceBtn.disabled = false;
  }
}

// Render Registered Member List in Tab 2
function renderRegisteredMemberList() {
  const container = elements.registeredMemberList;
  if (!container) return;

  if (registeredMembers.length === 0) {
    container.innerHTML = `<div class="text-center py-6 text-slate-500 text-sm">尚無已註冊團員</div>`;
    return;
  }

  container.innerHTML = registeredMembers.map(m => `
    <div class="glass-card p-3 rounded-xl flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 rounded-full overflow-hidden bg-slate-700 flex-shrink-0 flex items-center justify-center font-bold">
          ${m.photoDataUrl ? `<img src="${m.photoDataUrl}" class="w-full h-full object-cover" />` : m.name.charAt(0)}
        </div>
        <div>
          <div class="font-medium text-slate-200">${m.name}</div>
          <div class="text-xs text-slate-400">建立時間：${new Date(m.createdAt).toLocaleDateString()}</div>
        </div>
      </div>
      <button 
        data-del-id="${m.id}" 
        class="btn-del-member px-3 py-1 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 rounded-lg text-xs transition-colors"
      >
        刪除
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-del-member').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delId;
      if (confirm('確定要刪除此團員資料？')) {
        await deleteMember(id);
        await refreshMembersAndMatcher();
        await refreshTodayAttendance();
        renderRegisteredMemberList();
      }
    });
  });
}

// ATTENDANCE LOGS & CSV EXPORT MODULE
async function renderLogsTable() {
  const dateStr = elements.logDateInput.value || getTodayDateStr();
  const logs = await getAttendanceByDate(dateStr);
  const tbody = elements.logsTableBody;

  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center py-8 text-slate-500 text-sm">
          該日期無點名紀錄
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = logs.map(log => `
    <tr class="border-b border-slate-800 text-sm hover:bg-slate-800/30">
      <td class="py-3 px-4 font-medium text-slate-200">${log.memberName}</td>
      <td class="py-3 px-4 text-slate-300">${log.timeStr}</td>
      <td class="py-3 px-4">
        <span class="px-2 py-0.5 rounded text-xs ${log.type === 'manual' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}">
          ${log.type === 'manual' ? '手動' : '人臉辨識'}
        </span>
      </td>
      <td class="py-3 px-4 text-emerald-400 font-semibold">已出席</td>
    </tr>
  `).join('');
}

// Export CSV for local iPhone download
async function exportAttendanceCSV() {
  const dateStr = elements.logDateInput.value || getTodayDateStr();
  const logs = await getAttendanceByDate(dateStr);

  if (logs.length === 0) {
    alert('該日期沒有可匯出的點名紀錄。');
    return;
  }

  // UTF-8 BOM prefix (\uFEFF) for Excel compatibility
  let csvContent = '\uFEFF';
  csvContent += '團員姓名,點名日期,點名時間,點名方式,點名狀態\n';

  logs.forEach(log => {
    const typeLabel = log.type === 'manual' ? '手動補點' : '離線人臉辨識';
    csvContent += `"${log.memberName}","${log.dateStr}","${log.timeStr}","${typeLabel}","已出席"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `list_點名紀錄_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// SETTINGS & EVENT LISTENERS
function setupEventListeners() {
  // Scan tab buttons
  elements.startScanBtn.addEventListener('click', startAttendanceScan);
  elements.switchCameraBtn.addEventListener('click', async () => {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    await startAttendanceScan();
  });

  // Register tab buttons
  elements.startRegCameraBtn.addEventListener('click', startRegistrationCamera);
  elements.captureFaceBtn.addEventListener('click', captureAndRegisterFace);

  // Logs tab
  elements.logDateInput.addEventListener('change', renderLogsTable);
  elements.exportCsvBtn.addEventListener('click', exportAttendanceCSV);

  // Settings
  elements.clearDataBtn.addEventListener('click', async () => {
    if (confirm('⚠️ 警告：這將會清除 IndexedDB 內所有成員與點名紀錄！確定要清除嗎？')) {
      await clearAllData();
      await refreshMembersAndMatcher();
      await refreshTodayAttendance();
      alert('所有資料已成功清除！');
      location.reload();
    }
  });

  elements.thresholdInput.addEventListener('input', (e) => {
    CONFIG.FACE_DISTANCE_THRESHOLD = parseFloat(e.target.value);
    elements.thresholdValue.textContent = CONFIG.FACE_DISTANCE_THRESHOLD;
    if (faceMatcher) {
      faceMatcher.distanceThreshold = CONFIG.FACE_DISTANCE_THRESHOLD;
    }
  });
}
