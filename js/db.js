/**
 * db.js - IndexedDB storage engine for member profiles & attendance records
 * Supports Multi-descriptor vector matching and attendance session resetting.
 */

const DB_NAME = 'ListAttendanceDB';
const DB_VERSION = 4;

let dbInstance = null;

export function initDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains('members')) {
        const memberStore = db.createObjectStore('members', { keyPath: 'id' });
        memberStore.createIndex('name', 'name', { unique: false });
        memberStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('attendance')) {
        const attendanceStore = db.createObjectStore('attendance', { keyPath: 'id' });
        attendanceStore.createIndex('memberId', 'memberId', { unique: false });
        attendanceStore.createIndex('dateStr', 'dateStr', { unique: false });
        attendanceStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('IndexedDB Error:', event.target.error);
      reject(event.target.error);
    };
  });
}

// MEMBER OPERATIONS
export async function getAllMembers() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('members', 'readonly');
    const store = tx.objectStore('members');
    const request = store.getAll();
    request.onsuccess = () => {
      const members = request.result || [];
      members.forEach(m => {
        // Ensure descriptors is an array of Float32Array / Array
        if (!m.descriptors || !Array.isArray(m.descriptors) || m.descriptors.length === 0) {
          m.descriptors = m.descriptor ? [Array.from(m.descriptor)] : [];
        }
      });
      resolve(members);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function addOrAppendMember({ name, descriptor, photoDataUrl }) {
  const db = await initDB();
  const members = await getAllMembers();
  const trimmedName = name.trim();

  // Find existing member by name
  const existingMember = members.find(m => m.name.toLowerCase() === trimmedName.toLowerCase());

  return new Promise((resolve, reject) => {
    const tx = db.transaction('members', 'readwrite');
    const store = tx.objectStore('members');

    const descriptorArray = descriptor ? Array.from(descriptor) : [];

    if (existingMember) {
      if (!existingMember.descriptors) existingMember.descriptors = [];
      if (descriptorArray.length === 128) {
        existingMember.descriptors.push(descriptorArray);
      }
      if (photoDataUrl) existingMember.photoDataUrl = photoDataUrl;

      const putReq = store.put(existingMember);
      putReq.onsuccess = () => resolve({ isNew: false, member: existingMember, count: existingMember.descriptors.length });
      putReq.onerror = () => reject(putReq.error);
    } else {
      const newRecord = {
        id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        name: trimmedName,
        descriptors: descriptorArray.length === 128 ? [descriptorArray] : [],
        photoDataUrl: photoDataUrl || '',
        createdAt: new Date().toISOString()
      };

      const addReq = store.put(newRecord);
      addReq.onsuccess = () => resolve({ isNew: true, member: newRecord, count: newRecord.descriptors.length });
      addReq.onerror = () => reject(addReq.error);
    }
  });
}

export async function deleteMember(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('members', 'readwrite');
    const store = tx.objectStore('members');
    const request = store.delete(id);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

// ATTENDANCE OPERATIONS
export async function getAttendanceByDate(dateStr) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attendance', 'readonly');
    const store = tx.objectStore('attendance');
    const index = store.index('dateStr');
    const request = index.getAll(dateStr);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function markAttendance(memberId, memberName, dateStr, type = 'face') {
  const db = await initDB();
  const now = new Date();
  const currentDateStr = dateStr || now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0];

  return new Promise((resolve, reject) => {
    const tx = db.transaction('attendance', 'readwrite');
    const store = tx.objectStore('attendance');
    const index = store.index('dateStr');
    
    const checkReq = index.getAll(currentDateStr);
    checkReq.onsuccess = () => {
      const todayLogs = checkReq.result || [];
      const existing = todayLogs.find(log => log.memberId === memberId);
      if (existing) {
        return resolve({ alreadyCheckedIn: true, record: existing });
      }

      const newRecord = {
        id: 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        memberId: memberId,
        memberName: memberName,
        dateStr: currentDateStr,
        timeStr: timeStr,
        timestamp: now.getTime(),
        status: 'present',
        type: type
      };

      const addReq = store.add(newRecord);
      addReq.onsuccess = () => resolve({ alreadyCheckedIn: false, record: newRecord });
      addReq.onerror = () => reject(addReq.error);
    };
    
    checkReq.onerror = () => reject(checkReq.error);
  });
}

export async function toggleManualAttendance(memberId, memberName, dateStr) {
  const db = await initDB();
  const now = new Date();
  const currentDateStr = dateStr || now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0];

  return new Promise((resolve, reject) => {
    const tx = db.transaction('attendance', 'readwrite');
    const store = tx.objectStore('attendance');
    const index = store.index('dateStr');

    const checkReq = index.getAll(currentDateStr);
    checkReq.onsuccess = () => {
      const todayLogs = checkReq.result || [];
      const existing = todayLogs.find(log => log.memberId === memberId);

      if (existing) {
        const delReq = store.delete(existing.id);
        delReq.onsuccess = () => resolve({ action: 'removed', recordId: existing.id });
        delReq.onerror = () => reject(delReq.error);
      } else {
        const newRecord = {
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          memberId: memberId,
          memberName: memberName,
          dateStr: currentDateStr,
          timeStr: timeStr,
          timestamp: now.getTime(),
          status: 'present',
          type: 'manual'
        };
        const addReq = store.add(newRecord);
        addReq.onsuccess = () => resolve({ action: 'added', record: newRecord });
        addReq.onerror = () => reject(addReq.error);
      }
    };
    checkReq.onerror = () => reject(checkReq.error);
  });
}

// Clear today's attendance logs (一鍵清空即時點名看板)
export async function clearTodayAttendance(dateStr) {
  const db = await initDB();
  const currentDateStr = dateStr || new Date().toISOString().split('T')[0];

  return new Promise((resolve, reject) => {
    const tx = db.transaction('attendance', 'readwrite');
    const store = tx.objectStore('attendance');
    const index = store.index('dateStr');
    const req = index.getAllKeys(currentDateStr);

    req.onsuccess = () => {
      const keys = req.result || [];
      keys.forEach(k => store.delete(k));
      tx.oncomplete = () => resolve(keys.length);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllData() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['members', 'attendance'], 'readwrite');
    tx.objectStore('members').clear();
    tx.objectStore('attendance').clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
