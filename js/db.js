/**
 * db.js - IndexedDB storage engine for member profiles & attendance records
 * Supports grouping (分組) and session-based attendance management.
 */

const DB_NAME = 'ListAttendanceDB';
const DB_VERSION = 2;

let dbInstance = null;

export function initDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Store for registered members
      if (!db.objectStoreNames.contains('members')) {
        const memberStore = db.createObjectStore('members', { keyPath: 'id' });
        memberStore.createIndex('name', 'name', { unique: false });
        memberStore.createIndex('group', 'group', { unique: false });
        memberStore.createIndex('createdAt', 'createdAt', { unique: false });
      } else {
        const tx = event.target.transaction;
        const memberStore = tx.objectStore('members');
        if (!memberStore.indexNames.contains('group')) {
          memberStore.createIndex('group', 'group', { unique: false });
        }
      }

      // Store for attendance logs
      if (!db.objectStoreNames.contains('attendance')) {
        const attendanceStore = db.createObjectStore('attendance', { keyPath: 'id' });
        attendanceStore.createIndex('memberId', 'memberId', { unique: false });
        attendanceStore.createIndex('dateStr', 'dateStr', { unique: false });
        attendanceStore.createIndex('group', 'group', { unique: false });
        attendanceStore.createIndex('timestamp', 'timestamp', { unique: false });
      } else {
        const tx = event.target.transaction;
        const attendanceStore = tx.objectStore('attendance');
        if (!attendanceStore.indexNames.contains('group')) {
          attendanceStore.createIndex('group', 'group', { unique: false });
        }
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
      // Backward compatibility fallback for group
      members.forEach(m => {
        if (!m.group) m.group = '第 1 組';
      });
      resolve(members);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function addMember(member) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('members', 'readwrite');
    const store = tx.objectStore('members');
    
    const record = {
      id: member.id || 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: member.name.trim(),
      group: (member.group || '第 1 組').trim(),
      descriptor: Array.from(member.descriptor),
      photoDataUrl: member.photoDataUrl || '',
      createdAt: member.createdAt || new Date().toISOString()
    };

    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

export async function updateMemberGroup(memberId, newGroup) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('members', 'readwrite');
    const store = tx.objectStore('members');
    const getReq = store.get(memberId);
    
    getReq.onsuccess = () => {
      const member = getReq.result;
      if (!member) return reject('Member not found');
      member.group = newGroup.trim();
      const putReq = store.put(member);
      putReq.onsuccess = () => resolve(member);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
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

export async function getAllAttendance() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('attendance', 'readonly');
    const store = tx.objectStore('attendance');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function markAttendance(memberId, memberName, memberGroup, dateStr, type = 'face') {
  const db = await initDB();
  const now = new Date();
  const currentDateStr = dateStr || now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0]; // HH:mm:ss

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
        group: memberGroup || '第 1 組',
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

export async function toggleManualAttendance(memberId, memberName, memberGroup, dateStr) {
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
        // Remove attendance
        const delReq = store.delete(existing.id);
        delReq.onsuccess = () => resolve({ action: 'removed', recordId: existing.id });
        delReq.onerror = () => reject(delReq.error);
      } else {
        // Add manual attendance
        const newRecord = {
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          memberId: memberId,
          memberName: memberName,
          group: memberGroup || '第 1 組',
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
