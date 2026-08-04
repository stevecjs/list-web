/**
 * app.js - Standalone Self-Contained Application Engine
 * ZERO external ES module imports for 100% browser compatibility.
 * Offline Face Recognition & Tap-Photo Attendance System (list.daliuren.cc)
 */

(function () {
  'use strict';

  // --- 1. INDEXEDDB ENGINE ---
  const DB_NAME = 'ListAttendanceDB';
  const DB_VERSION = 5;
  let dbInstance = null;

  function initDB() {
    return new Promise((resolve, reject) => {
      if (dbInstance) return resolve(dbInstance);
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('members')) {
          const memberStore = db.createObjectStore('members', { keyPath: 'id' });
          memberStore.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('attendance')) {
          const attendanceStore = db.createObjectStore('attendance', { keyPath: 'id' });
          attendanceStore.createIndex('memberId', 'memberId', { unique: false });
          attendanceStore.createIndex('dateStr', 'dateStr', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };

      request.onerror = (event) => reject(event.target.error);
    });
  }

  function getAllMembersDB() {
    return initDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('members', 'readonly');
        const store = tx.objectStore('members');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function addOrUpdateMemberDB(memberData) {
    return initDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('members', 'readwrite');
        const store = tx.objectStore('members');
        const req = store.put(memberData);
        req.onsuccess = () => resolve(memberData);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function deleteMemberDB(id) {
    return initDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('members', 'readwrite');
        const store = tx.objectStore('members');
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function getAttendanceByDateDB(dateStr) {
    return initDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('attendance', 'readonly');
        const store = tx.objectStore('attendance');
        const index = store.index('dateStr');
        const req = index.getAll(dateStr);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function toggleAttendanceDB(memberId, memberName, dateStr) {
    return initDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('attendance', 'readwrite');
        const store = tx.objectStore('attendance');
        const index = store.index('dateStr');
        const req = index.getAll(dateStr);

        req.onsuccess = () => {
          const logs = req.result || [];
          const existing = logs.find(l => l.memberId === memberId);
          const now = new Date();

          if (existing) {
            const delReq = store.delete(existing.id);
            delReq.onsuccess = () => resolve({ action: 'removed' });
          } else {
            const newRecord = {
              id: 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
              memberId: memberId,
              memberName: memberName,
              dateStr: dateStr,
              timeStr: now.toTimeString().split(' ')[0],
              timestamp: now.getTime(),
              type: 'tap'
            };
            const addReq = store.add(newRecord);
            addReq.onsuccess = () => resolve({ action: 'added', record: newRecord });
          }
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  function clearAttendanceByDateDB(dateStr) {
    return initDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('attendance', 'readwrite');
        const store = tx.objectStore('attendance');
        const index = store.index('dateStr');
        const req = index.getAllKeys(dateStr);

        req.onsuccess = () => {
          const keys = req.result || [];
          keys.forEach(k => store.delete(k));
          tx.oncomplete = () => resolve(keys.length);
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  // --- 2. AUDIO SYNTHESIZER ---
  let audioCtx = null;
  function playChimeSound() {
    try {
      if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) audioCtx = new AudioContext();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      if (!audioCtx) return;

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.15);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch (e) {
      console.warn('Audio error:', e);
    }
  }

  // --- 3. APPLICATION STATE & DOM HELPERS ---
  const $ = id => document.getElementById(id);
  const $$ = sel => document.querySelectorAll(sel);

  let registeredMembers = [];
  let todayAttendance = [];
  let selectedMemberIds = new Set();
  let filterMode = 'ALL'; // 'ALL' or 'SELECTED'

  let activeStream = null;
  let currentFacingMode = 'user';
  let isAiModelLoaded = false;
  let faceMatcher = null;
  let scanIntervalId = null;

  function getTodayStr() {
    return new Date().toISOString().split('T')[0];
  }

  // --- 4. RENDERERS ---
  async function refreshData() {
    registeredMembers = await getAllMembersDB();
    todayAttendance = await getAttendanceByDateDB(getTodayStr());

    if (selectedMemberIds.size === 0) {
      registeredMembers.forEach(m => selectedMemberIds.add(m.id));
    }

    renderBoard();
    renderRegisteredList();
  }

  function renderBoard() {
    const container = $('board-member-grid');
    const presentCountEl = $('present-count');
    const totalCountEl = $('total-count');
    const targetCountEl = $('target-count-badge');

    if (!container) return;

    const displayMembers = filterMode === 'SELECTED'
      ? registeredMembers.filter(m => selectedMemberIds.has(m.id))
      : registeredMembers;

    const attendedMap = new Map();
    todayAttendance.forEach(a => attendedMap.set(a.memberId, a));

    const presentCount = displayMembers.filter(m => attendedMap.has(m.id)).length;
    if (presentCountEl) presentCountEl.textContent = presentCount;
    if (totalCountEl) totalCountEl.textContent = displayMembers.length;
    if (targetCountEl) targetCountEl.textContent = selectedMemberIds.size;

    if (displayMembers.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-10 text-center text-slate-400 text-sm">
          尚無成員，請在下方「新增團員」或點擊「🎯 挑選點名對象」。
        </div>
      `;
      return;
    }

    container.innerHTML = displayMembers.map(m => {
      const isAttended = attendedMap.has(m.id);
      const attRecord = attendedMap.get(m.id);

      return `
        <div 
          data-id="${m.id}"
          class="member-card cursor-pointer p-3.5 rounded-2xl flex items-center justify-between transition-all duration-200 ${
            isAttended
              ? 'bg-emerald-950/60 border-2 border-emerald-500/80 shadow-lg shadow-emerald-500/10'
              : 'bg-slate-900/90 border-2 border-slate-700/80 hover:border-sky-500/50'
          }"
        >
          <div class="flex items-center space-x-3">
            <div class="w-12 h-12 rounded-xl overflow-hidden bg-slate-800 flex-shrink-0 flex items-center justify-center font-bold text-lg text-white border border-slate-600">
              ${m.photoDataUrl ? `<img src="${m.photoDataUrl}" class="w-full h-full object-cover" />` : m.name.charAt(0)}
            </div>
            <div>
              <div class="font-extrabold text-base text-white">${m.name}</div>
              <div class="text-xs font-semibold ${isAttended ? 'text-emerald-400' : 'text-slate-400'}">
                ${isAttended ? `✓ 已出席 (${attRecord.timeStr})` : '未出席'}
              </div>
            </div>
          </div>
          <div class="px-3 py-1.5 rounded-full text-xs font-extrabold tracking-wider ${
            isAttended ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400 border border-slate-700'
          }">
            ${isAttended ? '已出席' : '未出席'}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.member-card').forEach(card => {
      card.addEventListener('click', async () => {
        const id = card.dataset.id;
        const member = registeredMembers.find(m => m.id === id);
        if (member) {
          playChimeSound();
          await toggleAttendanceDB(member.id, member.name, getTodayStr());
          await refreshData();
        }
      });
    });
  }

  function renderRegisteredList() {
    const container = $('registered-member-list');
    if (!container) return;

    if (registeredMembers.length === 0) {
      container.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs">尚無已註冊團員</div>`;
      return;
    }

    container.innerHTML = registeredMembers.map(m => `
      <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-lg overflow-hidden bg-slate-800 flex-shrink-0 flex items-center justify-center font-bold text-white border border-slate-700">
            ${m.photoDataUrl ? `<img src="${m.photoDataUrl}" class="w-full h-full object-cover" />` : m.name.charAt(0)}
          </div>
          <div>
            <div class="font-bold text-sm text-white">${m.name}</div>
            <div class="text-[10px] text-slate-400">註冊時間：${new Date(m.createdAt).toLocaleDateString()}</div>
          </div>
        </div>
        <button data-del-id="${m.id}" class="btn-del-mem px-3 py-1 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/30 rounded-lg text-xs font-bold transition-colors">
          刪除
        </button>
      </div>
    `).join('');

    container.querySelectorAll('.btn-del-mem').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.delId;
        if (confirm('確定要刪除此團員資料？')) {
          await deleteMemberDB(id);
          selectedMemberIds.delete(id);
          await refreshData();
        }
      });
    });
  }

  // --- 5. CAMERA & REGISTRATION ---
  async function startCamera(facingMode = 'user') {
    try {
      if (activeStream) {
        activeStream.getTracks().forEach(t => t.stop());
      }
      const constraints = { video: { facingMode: facingMode, width: { ideal: 640 }, height: { ideal: 480 } } };
      activeStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      const video = $('main-video');
      if (video) {
        video.srcObject = activeStream;
        await video.play();
      }
      return activeStream;
    } catch (err) {
      alert('無法開啟相機，請檢查瀏覽器相機存取權限。');
      return null;
    }
  }

  function stopCamera() {
    if (activeStream) {
      activeStream.getTracks().forEach(t => t.stop());
      activeStream = null;
    }
    const video = $('main-video');
    if (video) video.srcObject = null;
    if (scanIntervalId) clearInterval(scanIntervalId);
  }

  async function registerMemberWithPhoto() {
    const nameInput = $('reg-name-input');
    const name = nameInput ? nameInput.value.trim() : '';

    if (!name) {
      alert('請先輸入團員姓名');
      if (nameInput) nameInput.focus();
      return;
    }

    const video = $('main-video');
    let photoDataUrl = '';

    if (video && video.videoWidth > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 160;
      const ctx = canvas.getContext('2d');
      const minDim = Math.min(video.videoWidth, video.videoHeight);
      const sx = (video.videoWidth - minDim) / 2;
      const sy = (video.videoHeight - minDim) / 2;
      ctx.drawImage(video, sx, sy, minDim, minDim, 0, 0, 160, 160);
      photoDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    }

    const newMember = {
      id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      name: name,
      photoDataUrl: photoDataUrl,
      createdAt: new Date().toISOString()
    };

    await addOrUpdateMemberDB(newMember);
    selectedMemberIds.add(newMember.id);
    playChimeSound();

    if (nameInput) nameInput.value = '';
    const statusMsg = $('reg-status-msg');
    if (statusMsg) statusMsg.textContent = `✓ 團員「${name}」註冊成功！`;

    await refreshData();
  }

  // --- 6. LOGS & CLIPBOARD ---
  async function generateLogsText() {
    const logs = await getAttendanceByDateDB(getTodayStr());
    const attendedMap = new Map();
    logs.forEach(l => attendedMap.set(l.memberId, l));

    const presentList = [];
    const absentList = [];

    registeredMembers.forEach(m => {
      if (attendedMap.has(m.id)) {
        presentList.push({ name: m.name, time: attendedMap.get(m.id).timeStr });
      } else {
        absentList.push(m.name);
      }
    });

    let txt = `📋 【點名紀錄 - list.daliuren.cc】\n`;
    txt += `📅 日期：${getTodayStr()}\n`;
    txt += `----------------------------------------\n`;
    txt += `✅ 已出席 (${presentList.length}/${registeredMembers.length} 人):\n`;
    if (presentList.length === 0) {
      txt += `  (尚無紀錄)\n`;
    } else {
      presentList.forEach((p, i) => txt += `  ${i + 1}. ${p.name} - ${p.time}\n`);
    }

    txt += `\n❌ 未出席 (${absentList.length}/${registeredMembers.length} 人):\n`;
    if (absentList.length === 0) {
      txt += `  (全員皆已出席 🎉)\n`;
    } else {
      absentList.forEach((a, i) => txt += `  ${i + 1}. ${a}\n`);
    }
    txt += `----------------------------------------\n`;

    return txt;
  }

  async function copyLogsToClipboard() {
    const text = await generateLogsText();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      playChimeSound();
      alert('✓ 已成功複製點名紀錄至剪貼簿！');
    } catch (e) {
      alert('複製失敗，請直接選擇框內文字複製。');
    }
  }

  // --- 7. EVENT BINDING & BOOTSTRAP ---
  function bindEvents() {
    // Open / Close Camera
    const btnOpenCam = $('btn-open-camera');
    const btnSwitchCam = $('btn-switch-camera');
    const btnPhotoReg = $('btn-photo-register');

    if (btnOpenCam) {
      btnOpenCam.addEventListener('click', async () => {
        await startCamera(currentFacingMode);
        if (btnOpenCam) btnOpenCam.classList.add('hidden');
        if (btnSwitchCam) btnSwitchCam.classList.remove('hidden');
        if (btnPhotoReg) btnPhotoReg.classList.remove('hidden');
      });
    }

    if (btnSwitchCam) {
      btnSwitchCam.addEventListener('click', async () => {
        currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
        await startCamera(currentFacingMode);
      });
    }

    if (btnPhotoReg) {
      btnPhotoReg.addEventListener('click', registerMemberWithPhoto);
    }

    // Reset Attendance Board
    const btnClearBoard = $('btn-clear-board');
    if (btnClearBoard) {
      btnClearBoard.addEventListener('click', async () => {
        if (confirm('🧹 確定要一鍵重置今日點名看板嗎？\n所有團員將恢復為未出席狀態。')) {
          await clearAttendanceByDateDB(getTodayStr());
          playChimeSound();
          await refreshData();
        }
      });
    }

    // Filter Buttons
    const btnFilterAll = $('btn-filter-all');
    const btnFilterSel = $('btn-filter-selected');

    if (btnFilterAll) {
      btnFilterAll.addEventListener('click', () => {
        filterMode = 'ALL';
        btnFilterAll.className = 'px-3 py-1.5 rounded-xl bg-sky-500 text-white font-extrabold text-xs shadow-md';
        if (btnFilterSel) btnFilterSel.className = 'px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs hover:text-white';
        renderBoard();
      });
    }

    if (btnFilterSel) {
      btnFilterSel.addEventListener('click', () => {
        filterMode = 'SELECTED';
        btnFilterSel.className = 'px-3 py-1.5 rounded-xl bg-sky-500 text-white font-extrabold text-xs shadow-md';
        if (btnFilterAll) btnFilterAll.className = 'px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs hover:text-white';
        renderBoard();
      });
    }

    // Target Selection Modal
    const btnOpenModal = $('btn-open-target-modal');
    const btnCloseModal = $('btn-close-modal');
    const modal = $('target-modal');
    const btnSaveModal = $('btn-save-target-selection');
    const btnSelectAll = $('btn-select-all');
    const btnDeselectAll = $('btn-deselect-all');

    if (btnOpenModal && modal) {
      btnOpenModal.addEventListener('click', () => {
        renderTargetChecklist();
        modal.classList.remove('hidden');
      });
    }

    if (btnCloseModal && modal) {
      btnCloseModal.addEventListener('click', () => modal.classList.add('hidden'));
    }

    if (btnSaveModal && modal) {
      btnSaveModal.addEventListener('click', () => {
        modal.classList.add('hidden');
        renderBoard();
      });
    }

    if (btnSelectAll) {
      btnSelectAll.addEventListener('click', () => {
        registeredMembers.forEach(m => selectedMemberIds.add(m.id));
        renderTargetChecklist();
      });
    }

    if (btnDeselectAll) {
      btnDeselectAll.addEventListener('click', () => {
        selectedMemberIds.clear();
        renderTargetChecklist();
      });
    }

    // Copy Logs
    const btnCopy = $('btn-copy-logs');
    if (btnCopy) btnCopy.addEventListener('click', copyLogsToClipboard);

    // Force Update PWA
    const btnUpdatePWA = $('btn-update-pwa');
    if (btnUpdatePWA) {
      btnUpdatePWA.addEventListener('click', async () => {
        if (confirm('🔄 確定要強制更新至最新版嗎？')) {
          if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (let r of regs) await r.unregister();
          }
          if ('caches' in window) {
            const keys = await caches.keys();
            for (let k of keys) await caches.delete(k);
          }
          window.location.href = window.location.origin + window.location.pathname + '?reload=' + Date.now();
        }
      });
    }
  }

  function renderTargetChecklist() {
    const container = $('target-checklist-container');
    const countEl = $('modal-checked-count');

    if (countEl) countEl.textContent = selectedMemberIds.size;
    if (!container) return;

    if (registeredMembers.length === 0) {
      container.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs">尚無已註冊團員</div>`;
      return;
    }

    container.innerHTML = registeredMembers.map(m => {
      const isChecked = selectedMemberIds.has(m.id);
      return `
        <label class="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer">
          <span class="text-sm font-bold text-white">${m.name}</span>
          <input type="checkbox" data-id="${m.id}" class="chk-mem-item w-5 h-5 accent-sky-500 rounded" ${isChecked ? 'checked' : ''} />
        </label>
      `;
    }).join('');

    container.querySelectorAll('.chk-mem-item').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = chk.dataset.id;
        if (chk.checked) selectedMemberIds.add(id);
        else selectedMemberIds.delete(id);
        if (countEl) countEl.textContent = selectedMemberIds.size;
      });
    });
  }

  // --- 8. INITIALIZE ---
  function boot() {
    bindEvents();
    refreshData();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(e => console.warn(e));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
