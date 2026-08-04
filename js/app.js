/**
 * app.js - Main Application Logic
 * Offline Face Recognition Attendance System with Dynamic Purpose Checklist & One-Click Clear
 * list.daliuren.cc
 */

import {
  initDB,
  getAllMembers,
  addOrAppendMember,
  deleteMember,
  getAttendanceByDate,
  getAllAttendance,
  markAttendance,
  toggleManualAttendance,
  clearTodayAttendance,
  clearAllData
} from './db.js';

import { initAudio, playBeepSound, playErrorSound } from './sound.js';

// Configuration & State
const CONFIG = {
  MODEL_URL: './models',
  FACE_DISTANCE_THRESHOLD: 0.60, // Standard threshold for TinyFaceDetector (0.60 is optimal)
  COOLDOWN_MS: 1500,
  DETECTION_INTERVAL_MS: 100
};

let currentTab = 'scan';
let isModelLoaded = false;
let isScanning = false;
let isRegistering = false;

let scanStream = null;
let regStream = null;

let scanFacingMode = 'user';
let regFacingMode = 'user';

let faceMatcher = null;
let registeredMembers = [];
let todayAttendance = [];
let scanIntervalId = null;
let regIntervalId = null;
let cooldownMap = new Map();

// Dynamic purpose selection state
let selectedMemberIds = new Set(); // Set of member IDs selected for current session
let activeFilterMode = 'ALL';      // 'ALL' or 'SELECTED'

// DOM Elements
const elements = {
  // Navigation
  tabButtons: document.querySelectorAll('.nav-tab'),
  tabContents: document.querySelectorAll('.tab-content'),
  
  // Header & Status
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  dateDisplay: document.getElementById('date-display'),
  diagModelStatus: document.getElementById('diag-model-status'),

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
  clearBoardBtn: document.getElementById('btn-clear-board'),
  filterAllBtn: document.getElementById('btn-filter-all'),
  filterSelectedOnlyBtn: document.getElementById('btn-filter-selected-only'),
  selectedTargetCount: document.getElementById('selected-target-count'),
  openTargetSelectorBtn: document.getElementById('btn-open-target-selector'),

  // Debug Stats
  dbgMemberCount: document.getElementById('dbg-member-count'),
  dbgVectorCount: document.getElementById('dbg-vector-count'),
  dbgThreshold: document.getElementById('dbg-threshold'),

  // Modal
  targetModal: document.getElementById('target-selector-modal'),
  closeModalBtn: document.getElementById('btn-close-modal'),
  selectAllBtn: document.getElementById('btn-select-all'),
  deselectAllBtn: document.getElementById('btn-deselect-all'),
  modalCheckedCount: document.getElementById('modal-checked-count'),
  modalMemberChecklist: document.getElementById('modal-member-checklist'),
  saveTargetSelectionBtn: document.getElementById('btn-save-target-selection'),

  // Register View
  regNameInput: document.getElementById('reg-name-input'),
  regVideo: document.getElementById('reg-video'),
  regCanvas: document.getElementById('reg-canvas'),
  startRegCameraBtn: document.getElementById('btn-start-reg-camera'),
  switchRegCameraBtn: document.getElementById('btn-switch-reg-camera'),
  regActionButtons: document.getElementById('reg-action-buttons'),
  captureFaceBtn: document.getElementById('btn-capture-face'),
  capturePhotoDirectBtn: document.getElementById('btn-capture-photo-direct'),
  resetRegFormBtn: document.getElementById('btn-reset-reg-form'),
  regStatusMsg: document.getElementById('reg-status-msg'),
  registeredMemberList: document.getElementById('registered-member-list'),

  // Logs View
  logDateInput: document.getElementById('log-date-input'),
  copyClipboardBtn: document.getElementById('btn-copy-clipboard'),
  logPreviewText: document.getElementById('log-preview-text'),

  // Settings View
  clearDataBtn: document.getElementById('btn-clear-data'),
  thresholdInput: document.getElementById('threshold-input'),
  thresholdValue: document.getElementById('threshold-value')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupEventListeners();
  updateClock();
  setInterval(updateClock, 1000);

  const todayStr = getTodayDateStr();
  if (elements.logDateInput) elements.logDateInput.value = todayStr;

  registerServiceWorker();

  await refreshMembersAndMatcher();
  await refreshTodayAttendance();
  await loadFaceModels();
});

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => console.log('Service Worker Registered:', reg.scope))
      .catch(err => console.error('Service Worker Registration Failed:', err));
  }
}

async function loadFaceModels() {
  updateStatus('載入離線 AI 模型中...', 'yellow');
  if (elements.diagModelStatus) elements.diagModelStatus.textContent = '下載/快取載入中...';

  try {
    if (typeof faceapi === 'undefined') {
      throw new Error('face-api.js Script 尚未載入');
    }

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(CONFIG.MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(CONFIG.MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(CONFIG.MODEL_URL)
    ]);

    isModelLoaded = true;
    updateStatus('離線 AI 人臉辨識引擎就緒', 'green');
    if (elements.diagModelStatus) elements.diagModelStatus.textContent = '✓ tinyFaceDetector 離線成功';
  } catch (err) {
    console.warn('Face models load warning:', err);
    updateStatus('離線 AI 辨識引擎準備中 (拍照模式就緒)', 'yellow');
    if (elements.diagModelStatus) elements.diagModelStatus.textContent = '⚠️ 離線 AI 模型準備中 (已開啟相片註冊與手動點名)';
  }
}

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
      initAudio();
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

  stopAllCameras();

  if (tabName === 'scan') {
    await refreshTodayAttendance();
  } else if (tabName === 'register') {
    renderRegisteredMemberList();
  } else if (tabName === 'logs') {
    renderLogsPreview();
  }
}

// Camera Controls
async function startCamera(videoElement, facingMode = 'user') {
  try {
    const constraints = {
      video: {
        facingMode: facingMode,
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    };

    const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = mediaStream;
    
    return new Promise((resolve) => {
      videoElement.onloadedmetadata = () => {
        videoElement.play();
        resolve(mediaStream);
      };
    });
  } catch (err) {
    console.error('Camera access error:', err);
    alert('無法存取相機，請確認 Safari 相機權限設定。');
    return null;
  }
}

function stopAllCameras() {
  if (scanIntervalId) {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
  }
  if (regIntervalId) {
    clearInterval(regIntervalId);
    regIntervalId = null;
  }
  isScanning = false;
  isRegistering = false;

  if (scanStream) {
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
  if (regStream) {
    regStream.getTracks().forEach(t => t.stop());
    regStream = null;
  }

  if (elements.scanVideo) elements.scanVideo.srcObject = null;
  if (elements.regVideo) elements.regVideo.srcObject = null;
}

// Refresh Members & Build FaceMatcher with RELIABLE DESCRIPTORS
async function refreshMembersAndMatcher() {
  registeredMembers = await getAllMembers();
  if (registeredMembers.length === 0) {
    faceMatcher = null;
    if (elements.dbgMemberCount) elements.dbgMemberCount.textContent = '0';
    if (elements.dbgVectorCount) elements.dbgVectorCount.textContent = '0';
    return;
  }

  let totalVectors = 0;
  const labeledDescriptors = [];

  registeredMembers.forEach(m => {
    const validDescriptors = [];

    if (m.descriptors && Array.isArray(m.descriptors) && m.descriptors.length > 0) {
      m.descriptors.forEach(d => {
        if (Array.isArray(d) && d.length === 128 && d.some(val => val !== 0)) {
          validDescriptors.push(new Float32Array(d));
        }
      });
    }

    if (validDescriptors.length > 0) {
      labeledDescriptors.push(new faceapi.LabeledFaceDescriptors(m.id, validDescriptors));
      totalVectors += validDescriptors.length;
    }
  });

  if (elements.dbgMemberCount) elements.dbgMemberCount.textContent = registeredMembers.length;
  if (elements.dbgVectorCount) elements.dbgVectorCount.textContent = totalVectors;
  if (elements.dbgThreshold) elements.dbgThreshold.textContent = CONFIG.FACE_DISTANCE_THRESHOLD.toFixed(2);

  if (labeledDescriptors.length > 0) {
    faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, CONFIG.FACE_DISTANCE_THRESHOLD);
  } else {
    faceMatcher = null;
  }

  // Initialize selectedMemberIds if empty
  if (selectedMemberIds.size === 0) {
    registeredMembers.forEach(m => selectedMemberIds.add(m.id));
  }
  if (elements.selectedTargetCount) elements.selectedTargetCount.textContent = selectedMemberIds.size;
}

// Refresh Attendance & Update Board UI
async function refreshTodayAttendance() {
  const today = getTodayDateStr();
  todayAttendance = await getAttendanceByDate(today);
  renderBoardMemberList();
}

// Render Attendance Status Board
function renderBoardMemberList() {
  const container = elements.boardMemberList;
  if (!container) return;

  const targetMembers = activeFilterMode === 'SELECTED'
    ? registeredMembers.filter(m => selectedMemberIds.has(m.id))
    : registeredMembers;

  const attendedSet = new Map();
  todayAttendance.forEach(a => attendedSet.set(a.memberId, a));

  const presentCount = targetMembers.filter(m => attendedSet.has(m.id)).length;
  elements.presentCount.textContent = presentCount;
  elements.totalCount.textContent = targetMembers.length;

  if (targetMembers.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-8 text-center text-slate-400 text-sm">
        此點名範圍尚無成員，請點擊「🎯 挑選點名對象」或新增團員。
      </div>
    `;
    return;
  }

  container.innerHTML = targetMembers.map(member => {
    const isPresent = attendedSet.has(member.id);
    const attRecord = attendedSet.get(member.id);
    const featureCount = (member.descriptors && member.descriptors.length) || (member.descriptor ? 1 : 0);

    return `
      <div 
        data-member-id="${member.id}"
        class="manual-toggle-card cursor-pointer p-3 rounded-xl flex items-center justify-between transition-all duration-200 ${
          isPresent ? 'bg-emerald-950/40 border border-emerald-500/40' : 'bg-slate-800/60 border border-slate-700/60'
        }"
      >
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-full overflow-hidden bg-slate-700 flex-shrink-0 flex items-center justify-center font-bold text-slate-200">
            ${member.photoDataUrl ? `<img src="${member.photoDataUrl}" class="w-full h-full object-cover" />` : member.name.charAt(0)}
          </div>
          <div>
            <div class="font-bold text-white flex items-center gap-1.5">
              ${member.name}
              <span class="text-[10px] text-sky-400">(${featureCount > 0 ? featureCount + '筆特徵' : '照片註冊'})</span>
            </div>
            <div class="text-xs font-semibold ${isPresent ? 'text-emerald-400' : 'text-slate-400'}">
              ${isPresent ? `已到 ‧ ${attRecord.timeStr} (${attRecord.type === 'manual' ? '手動' : '人臉'})` : '未到'}
            </div>
          </div>
        </div>
        <div class="px-2.5 py-1 rounded-full text-xs font-bold ${
          isPresent ? 'badge-present' : 'badge-absent'
        }">
          ${isPresent ? '✓ 已出席' : '未出席'}
        </div>
      </div>
    `;
  }).join('');

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

// REAL-TIME FACE ATTENDANCE SCANNING WITH DEBUG DISTANCE DISPLAY
async function startAttendanceScan() {
  initAudio();

  scanStream = await startCamera(elements.scanVideo, scanFacingMode);
  if (!scanStream) return;

  isScanning = true;
  elements.startScanBtn.classList.add('hidden');
  elements.switchCameraBtn.classList.remove('hidden');

  const video = elements.scanVideo;
  const canvas = elements.scanCanvas;

  scanIntervalId = setInterval(async () => {
    if (!isScanning || !video || video.paused || video.ended || video.videoWidth === 0) return;

    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    if (!isModelLoaded || !faceMatcher) return;

    try {
      const options = new faceapi.TinyFaceOptions({ inputSize: 224, scoreThreshold: 0.35 });
      const detections = await faceapi.detectAllFaces(video, options)
        .withFaceLandmarks(true)
        .withFaceDescriptors();

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (detections.length === 0) return;

      const resizedDetections = faceapi.resizeResults(detections, { width: canvas.width, height: canvas.height });

      for (const detection of resizedDetections) {
        const box = detection.detection.box;
        
        const bestMatch = faceMatcher.findBestMatch(detection.descriptor);
        let label = '未知臉孔';
        let isMatched = false;
        let matchedMember = null;
        const distStr = bestMatch.distance.toFixed(2);

        if (bestMatch.label !== 'unknown') {
          matchedMember = registeredMembers.find(m => m.id === bestMatch.label);
          if (matchedMember) {
            label = `${matchedMember.name} (${distStr})`;
            isMatched = true;
          }
        } else {
          label = `未知 (近: ${distStr})`;
        }

        ctx.lineWidth = 3;
        ctx.strokeStyle = isMatched ? '#10b981' : '#f43f5e';
        ctx.strokeRect(box.x, box.y, box.width, box.height);

        ctx.fillStyle = isMatched ? 'rgba(16, 185, 129, 0.95)' : 'rgba(244, 63, 94, 0.95)';
        ctx.fillRect(box.x, box.y - 28, Math.max(140, box.width), 28);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(label, box.x + 8, box.y - 8);

        if (isMatched && matchedMember) {
          const nowMs = Date.now();
          const cooldownUntil = cooldownMap.get(matchedMember.id) || 0;

          if (nowMs > cooldownUntil) {
            cooldownMap.set(matchedMember.id, nowMs + CONFIG.COOLDOWN_MS);

            const result = await markAttendance(
              matchedMember.id, 
              matchedMember.name, 
              getTodayDateStr(), 
              'face'
            );

            if (!result.alreadyCheckedIn) {
              playBeepSound();
              showSuccessBanner(matchedMember.name, result.record.timeStr);
              await refreshTodayAttendance();
            }
          }
        }
      }
    } catch (err) {
      console.warn('Face scan tick warning:', err);
    }
  }, CONFIG.DETECTION_INTERVAL_MS);
}

function showSuccessBanner(name, timeStr) {
  elements.bannerName.textContent = name;
  elements.bannerTime.textContent = timeStr;
  elements.scanSuccessBanner.classList.remove('hidden');

  setTimeout(() => {
    elements.scanSuccessBanner.classList.add('hidden');
  }, 2200);
}

// MEMBER REGISTRATION MODULE WITH DUAL FALLBACK
async function startRegistrationCamera() {
  initAudio();
  regStream = await startCamera(elements.regVideo, regFacingMode);
  if (regStream) {
    isRegistering = true;
    elements.startRegCameraBtn.classList.add('hidden');
    elements.switchRegCameraBtn.classList.remove('hidden');
    elements.regActionButtons.classList.remove('hidden');
    elements.regStatusMsg.textContent = '📷 相機已啟動！可選「🤖 AI特徵擷取」或「📷 拍照直接註冊」';
    elements.regStatusMsg.className = 'text-xs text-sky-300 font-semibold text-center min-h-[20px]';

    startRegistrationLivePreview();
  }
}

function startRegistrationLivePreview() {
  const video = elements.regVideo;
  const canvas = elements.regCanvas;

  if (regIntervalId) clearInterval(regIntervalId);

  regIntervalId = setInterval(async () => {
    if (!isRegistering || !video || video.paused || video.ended || video.videoWidth === 0) return;

    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    if (!isModelLoaded) return;

    try {
      const options = new faceapi.TinyFaceOptions({ inputSize: 224, scoreThreshold: 0.35 });
      const detection = await faceapi.detectSingleFace(video, options);

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (detection) {
        const box = detection.box;
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#38bdf8';
        ctx.strokeRect(box.x, box.y, box.width, box.height);

        ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
        ctx.fillRect(box.x, box.y - 24, 140, 24);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('✓ 已瞄準臉部', box.x + 6, box.y - 7);

        elements.regStatusMsg.textContent = '🟢 已瞄準人臉，請點擊「🤖 AI人臉特徵擷取」！';
        elements.regStatusMsg.className = 'text-xs text-emerald-400 font-bold text-center min-h-[20px] animate-pulse';
      }
    } catch (err) {
      // Ignore preview errors
    }
  }, 150);
}

function resetRegistrationForm() {
  stopAllCameras();
  elements.regNameInput.value = '';
  elements.regStatusMsg.textContent = '請點擊開啟相機並對準臉部';
  elements.regStatusMsg.className = 'text-xs text-slate-300 text-center min-h-[20px]';
  elements.startRegCameraBtn.classList.remove('hidden');
  elements.switchRegCameraBtn.classList.add('hidden');
  elements.regActionButtons.classList.add('hidden');
}

async function captureAndRegisterFace() {
  const name = elements.regNameInput.value.trim();

  if (!name) {
    alert('請先輸入團員姓名');
    elements.regNameInput.focus();
    return;
  }

  const video = elements.regVideo;
  if (!video || video.videoWidth === 0) {
    alert('相機尚未準備就緒，請重新點擊開啟註冊相機。');
    return;
  }

  elements.captureFaceBtn.disabled = true;
  elements.regStatusMsg.textContent = '⏳ AI 特徵比對計算中...';

  try {
    let detection = null;
    if (isModelLoaded) {
      const sizes = [224, 160, 320];
      for (const size of sizes) {
        const options = new faceapi.TinyFaceOptions({ inputSize: size, scoreThreshold: 0.25 });
        detection = await faceapi.detectSingleFace(video, options)
          .withFaceLandmarks(true)
          .withFaceDescriptor();
        if (detection) break;
      }
    }

    if (!detection) {
      if (confirm(`🤖 AI 未能辨識出精確特徵。\n\n是否直接以「📷 拍照方式」完成「${name}」的成員註冊？(可正常顯示於看板並點名紀錄)`)) {
        await capturePhotoDirectRegister();
      } else {
        elements.regStatusMsg.textContent = '💡 提示：可調整光線、靠近鏡頭，或直接使用「📷 拍照直接註冊」。';
        elements.regStatusMsg.className = 'text-xs text-amber-300 font-bold text-center min-h-[20px]';
      }
      elements.captureFaceBtn.disabled = false;
      return;
    }

    const photoDataUrl = captureVideoSnapshot(video);

    const result = await addOrAppendMember({
      name: name,
      descriptor: Array.from(detection.descriptor),
      photoDataUrl: photoDataUrl
    });

    playBeepSound();

    if (result.isNew) {
      elements.regStatusMsg.textContent = `🎉 團員「${name}」註冊成功！可再微轉角度追加特徵！`;
    } else {
      elements.regStatusMsg.textContent = `✓ 已為「${name}」成功追加第 ${result.count} 筆特徵碼！`;
    }
    elements.regStatusMsg.className = 'text-xs text-emerald-400 font-bold text-center min-h-[20px]';

    await refreshMembersAndMatcher();
    renderRegisteredMemberList();

  } catch (err) {
    console.error('Face capture error:', err);
    await capturePhotoDirectRegister();
  } finally {
    elements.captureFaceBtn.disabled = false;
  }
}

async function capturePhotoDirectRegister() {
  const name = elements.regNameInput.value.trim();

  if (!name) {
    alert('請先輸入團員姓名');
    elements.regNameInput.focus();
    return;
  }

  const video = elements.regVideo;
  const photoDataUrl = captureVideoSnapshot(video);
  const dummyDescriptor = new Array(128).fill(0);

  const result = await addOrAppendMember({
    name: name,
    descriptor: dummyDescriptor,
    photoDataUrl: photoDataUrl
  });

  playBeepSound();

  elements.regStatusMsg.textContent = `✓ 已完成「${name}」拍照註冊！(可正常於看板點名)`;
  elements.regStatusMsg.className = 'text-xs text-emerald-400 font-bold text-center min-h-[20px]';

  await refreshMembersAndMatcher();
  renderRegisteredMemberList();
}

function captureVideoSnapshot(video) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  const width = video.videoWidth || 320;
  const height = video.videoHeight || 240;
  const minDim = Math.min(width, height);
  const sx = (width - minDim) / 2;
  const sy = (height - minDim) / 2;
  ctx.drawImage(video, sx, sy, minDim, minDim, 0, 0, 160, 160);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function renderRegisteredMemberList() {
  const container = elements.registeredMemberList;
  if (!container) return;

  if (registeredMembers.length === 0) {
    container.innerHTML = `<div class="text-center py-6 text-slate-400 text-sm">尚無已註冊團員</div>`;
    return;
  }

  container.innerHTML = registeredMembers.map(m => {
    const featCount = (m.descriptors && m.descriptors.length) || (m.descriptor ? 1 : 0);
    return `
      <div class="glass-card p-3 rounded-xl flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-full overflow-hidden bg-slate-700 flex-shrink-0 flex items-center justify-center font-bold text-white border border-slate-600">
            ${m.photoDataUrl ? `<img src="${m.photoDataUrl}" class="w-full h-full object-cover" />` : m.name.charAt(0)}
          </div>
          <div>
            <div class="font-bold text-white flex items-center gap-1.5">
              ${m.name}
            </div>
            <div class="text-xs text-sky-400 font-medium flex items-center gap-1">
              <span>📸 ${featCount > 0 ? featCount + ' 筆特徵向量' : '拍照註冊'}</span>
              <span class="text-slate-500">‧</span>
              <span class="text-slate-400">${new Date(m.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <button 
            data-append-name="${m.name}"
            class="btn-append-feature px-2.5 py-1 bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 border border-sky-500/40 rounded-lg text-xs font-semibold transition-colors flex items-center gap-0.5"
          >
            ＋追加特徵
          </button>
          <button 
            data-del-id="${m.id}" 
            class="btn-del-member px-2.5 py-1 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30 rounded-lg text-xs font-medium transition-colors"
          >
            刪除
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-append-feature').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.appendName;
      elements.regNameInput.value = name;
      window.scrollTo({ top: 0, behavior: 'smooth' });

      if (!isRegistering) {
        await startRegistrationCamera();
      }

      elements.regStatusMsg.textContent = `請將「${name}」稍微轉動微角度 (正臉/側臉/戴眼鏡/笑臉) 並點擊擷取特徵！`;
      elements.regStatusMsg.className = 'text-xs text-sky-300 font-bold text-center min-h-[20px]';
    });
  });

  container.querySelectorAll('.btn-del-member').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delId;
      if (confirm('確定要刪除此團員資料？')) {
        await deleteMember(id);
        selectedMemberIds.delete(id);
        await refreshMembersAndMatcher();
        await refreshTodayAttendance();
        renderRegisteredMemberList();
      }
    });
  });
}

// TARGET SELECTOR MODAL DRAWER
function renderTargetSelectorModal() {
  const container = elements.modalMemberChecklist;
  if (!container) return;

  if (registeredMembers.length === 0) {
    container.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs">尚無已註冊團員</div>`;
    return;
  }

  container.innerHTML = registeredMembers.map(m => {
    const isChecked = selectedMemberIds.has(m.id);
    return `
      <label class="flex items-center justify-between p-2 rounded-lg bg-slate-800/60 hover:bg-slate-800 cursor-pointer border border-slate-700/50">
        <div class="flex items-center space-x-2.5">
          <input type="checkbox" data-id="${m.id}" class="chk-target-member w-4 h-4 accent-sky-500 rounded" ${isChecked ? 'checked' : ''} />
          <span class="text-xs font-bold text-white">${m.name}</span>
        </div>
      </label>
    `;
  }).join('');

  updateModalCheckedCount();

  container.querySelectorAll('.chk-target-member').forEach(chk => {
    chk.addEventListener('change', () => {
      const id = chk.dataset.id;
      if (chk.checked) {
        selectedMemberIds.add(id);
      } else {
        selectedMemberIds.delete(id);
      }
      updateModalCheckedCount();
    });
  });
}

function updateModalCheckedCount() {
  if (elements.modalCheckedCount) {
    elements.modalCheckedCount.textContent = selectedMemberIds.size;
  }
}

// LOGS & CLIPBOARD COPY MODULE
async function renderLogsPreview() {
  const dateStr = elements.logDateInput.value || getTodayDateStr();
  const logs = await getAttendanceByDate(dateStr);
  const attendedMap = new Map();
  logs.forEach(l => attendedMap.set(l.memberId, l));

  const presentList = [];
  const absentList = [];

  registeredMembers.forEach(m => {
    if (attendedMap.has(m.id)) {
      presentList.push({ member: m, log: attendedMap.get(m.id) });
    } else {
      absentList.push(m);
    }
  });

  const now = new Date();

  let text = `📋 【點名紀錄 - list.daliuren.cc】\n`;
  text += `📅 點名日期：${dateStr}\n`;
  text += `----------------------------------------\n`;
  text += `✅ 已出席 (${presentList.length}/${registeredMembers.length} 人):\n`;

  if (presentList.length === 0) {
    text += `  (尚無出席紀錄)\n`;
  } else {
    presentList.forEach((item, index) => {
      const typeStr = item.log.type === 'manual' ? '手動' : '人臉辨識';
      text += `  ${index + 1}. ${item.member.name} - ${item.log.timeStr} (${typeStr})\n`;
    });
  }

  text += `\n❌ 未出席 (${absentList.length}/${registeredMembers.length} 人):\n`;
  if (absentList.length === 0) {
    text += `  (全員皆已出席 🎉)\n`;
  } else {
    absentList.forEach((m, index) => {
      text += `  ${index + 1}. ${m.name}\n`;
    });
  }

  text += `----------------------------------------\n`;
  text += `紀錄產生時間：${now.toLocaleString('zh-TW')}\n`;

  if (elements.logPreviewText) {
    elements.logPreviewText.value = text;
  }

  return text;
}

async function copyLogsToClipboard() {
  const text = await renderLogsPreview();

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      elements.logPreviewText.select();
      document.execCommand('copy');
    }
    playBeepSound();
    alert('✓ 已成功複製點名紀錄至剪貼簿！');
  } catch (err) {
    console.error('Clipboard copy error:', err);
    alert('複製失敗，請手動全選下方框內文字進行複製。');
  }
}

// SETTINGS & EVENT LISTENERS
function setupEventListeners() {
  // Scan tab buttons
  elements.startScanBtn.addEventListener('click', startAttendanceScan);
  elements.switchCameraBtn.addEventListener('click', async () => {
    scanFacingMode = scanFacingMode === 'user' ? 'environment' : 'user';
    await startAttendanceScan();
  });

  // One-click Clear Attendance Board Button
  elements.clearBoardBtn.addEventListener('click', async () => {
    if (confirm('🧹 確定要一鍵清空今日/本次點名看板嗎？\n所有團員將恢復為「未出席」狀態。')) {
      await clearTodayAttendance(getTodayDateStr());
      playBeepSound();
      await refreshTodayAttendance();
    }
  });

  // Dynamic filter buttons
  elements.filterAllBtn.addEventListener('click', () => {
    activeFilterMode = 'ALL';
    elements.filterAllBtn.className = 'px-2.5 py-1 rounded-lg bg-sky-500 text-white font-bold';
    elements.filterSelectedOnlyBtn.className = 'px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 font-medium hover:text-white';
    renderBoardMemberList();
  });

  elements.filterSelectedOnlyBtn.addEventListener('click', () => {
    activeFilterMode = 'SELECTED';
    elements.filterSelectedOnlyBtn.className = 'px-2.5 py-1 rounded-lg bg-sky-500 text-white font-bold';
    elements.filterAllBtn.className = 'px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 font-medium hover:text-white';
    renderBoardMemberList();
  });

  // Modal open / close
  elements.openTargetSelectorBtn.addEventListener('click', () => {
    renderTargetSelectorModal();
    elements.targetModal.classList.remove('hidden');
  });

  elements.closeModalBtn.addEventListener('click', () => {
    elements.targetModal.classList.add('hidden');
  });

  elements.selectAllBtn.addEventListener('click', () => {
    registeredMembers.forEach(m => selectedMemberIds.add(m.id));
    renderTargetSelectorModal();
  });

  elements.deselectAllBtn.addEventListener('click', () => {
    selectedMemberIds.clear();
    renderTargetSelectorModal();
  });

  elements.saveTargetSelectionBtn.addEventListener('click', () => {
    elements.targetModal.classList.add('hidden');
    if (elements.selectedTargetCount) elements.selectedTargetCount.textContent = selectedMemberIds.size;
    renderBoardMemberList();
  });

  // Register tab buttons
  elements.startRegCameraBtn.addEventListener('click', startRegistrationCamera);
  elements.switchRegCameraBtn.addEventListener('click', async () => {
    regFacingMode = regFacingMode === 'user' ? 'environment' : 'user';
    await startRegistrationCamera();
  });
  elements.captureFaceBtn.addEventListener('click', captureAndRegisterFace);
  elements.capturePhotoDirectBtn.addEventListener('click', capturePhotoDirectRegister);
  elements.resetRegFormBtn.addEventListener('click', resetRegistrationForm);

  // Logs tab
  elements.logDateInput.addEventListener('change', renderLogsPreview);
  elements.copyClipboardBtn.addEventListener('click', copyLogsToClipboard);

  // Settings
  elements.clearDataBtn.addEventListener('click', async () => {
    if (confirm('⚠️ 警告：這將會清除 IndexedDB 內所有成員與點名紀錄！確定要清除嗎？')) {
      await clearAllData();
      selectedMemberIds.clear();
      await refreshMembersAndMatcher();
      await refreshTodayAttendance();
      alert('所有資料已成功清除！');
      location.reload();
    }
  });

  elements.thresholdInput.addEventListener('input', (e) => {
    CONFIG.FACE_DISTANCE_THRESHOLD = parseFloat(e.target.value);
    elements.thresholdValue.textContent = CONFIG.FACE_DISTANCE_THRESHOLD.toFixed(2);
    if (elements.dbgThreshold) elements.dbgThreshold.textContent = CONFIG.FACE_DISTANCE_THRESHOLD.toFixed(2);
    if (faceMatcher) {
      faceMatcher.distanceThreshold = CONFIG.FACE_DISTANCE_THRESHOLD;
    }
  });
}
