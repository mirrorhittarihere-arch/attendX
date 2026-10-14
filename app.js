import { auth as firebaseAuth, db as firebaseDb } from './firebase-config.js';
import { signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { doc, getDoc, setDoc, updateDoc, collection, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

// Firebase Authentication is enabled for teacher login. Attendance data is still demo/local
// until the Firestore data layer is implemented in the next phase.
const USE_FIREBASE_AUTH = true;
const STATE_VERSION = 2;
const STORAGE_KEY = 'attendx-demo-state';
const AUTH_KEY = 'attendx-auth';


const $ = (id) => document.getElementById(id);
const PAGE = document.body.dataset.page || 'login';
const on = (id, event, handler) => $(id)?.addEventListener(event, handler);
const now = () => new Date();
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' });
const fullDateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name = '?') => name.split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase();
const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

let state;
let auth = null;
let activeSessionId = null;
let countdownInterval = null;
let qrScanner = null;
let scannerRunning = false;
let studentScanner = null;
let studentScannerRunning = false;
let selectedStudentId = null;
let cloudUnsubSessions = null;
let cloudAttendanceUnsubs = new Map();
let cloudAttendanceBySession = new Map();
let cloudSyncStarted = false;

const seedStudents = [
  ['Aarav Sharma', 'BCA2401', 'BCA', '4th', 'aarav.sharma@example.com'],
  ['Aditi Verma', 'BCA2402', 'BCA', '4th', 'aditi.verma@example.com'],
  ['Rohan Singh', 'BCA2403', 'BCA', '4th', 'rohan.singh@example.com'],
  ['Ishita Gupta', 'BCA2404', 'BCA', '4th', 'ishita.gupta@example.com'],
  ['Vivaan Kumar', 'BCA2405', 'BCA', '4th', 'vivaan.kumar@example.com'],
  ['Ananya Mishra', 'BCA2406', 'BCA', '4th', 'ananya.mishra@example.com'],
  ['Kabir Khan', 'BCA2407', 'BCA', '4th', 'kabir.khan@example.com'],
  ['Saanvi Jain', 'BCA2408', 'BCA', '4th', 'saanvi.jain@example.com'],
  ['Advik Patel', 'BCA2409', 'BCA', '4th', 'advik.patel@example.com'],
  ['Myra Joshi', 'BCA2410', 'BCA', '4th', 'myra.joshi@example.com'],
  ['Reyansh Yadav', 'BCA2411', 'BCA', '4th', 'reyansh.yadav@example.com'],
  ['Kiara Das', 'BCA2412', 'BCA', '4th', 'kiara.das@example.com']
].map((x, i) => ({ id: `STU${i + 1}`, name: x[0], roll: x[1], course: x[2], semester: x[3], email: x[4] }));

const seedSubjects = [
  { id: 'SUB401', name: 'Database Management Systems', code: 'BCA-401', description: 'Relational database concepts, SQL, normalization and transactions.', teacher: 'Dr. Meera Sharma' },
  { id: 'SUB402', name: 'Operating Systems', code: 'BCA-402', description: 'Processes, scheduling, memory management and file systems.', teacher: 'Prof. Arvind Rao' },
  { id: 'SUB403', name: 'Java Programming', code: 'BCA-403', description: 'OOP, exception handling, collections and application development.', teacher: 'Ms. Kavya Nair' },
  { id: 'SUB404', name: 'Computer Networks', code: 'BCA-404', description: 'Network models, routing, IP addressing and communication protocols.', teacher: 'Mr. Sameer Khan' },
  { id: 'SUB405', name: 'Web Technology', code: 'BCA-405', description: 'HTML, CSS, JavaScript, responsive layouts and web project design.', teacher: 'Dr. Neha Verma' }
];

function cloudDate(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return fallback;
}

function startCloudAttendanceSync() {
  if (cloudSyncStarted || !auth?.uid || !['teacher', 'student'].includes(auth.role)) return;
  cloudSyncStarted = true;
  cloudUnsubSessions = onSnapshot(collection(firebaseDb, 'sessions'), (snapshot) => {
    const cloudSessions = snapshot.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        subject: data.subject || 'Untitled subject',
        className: data.className || 'BCA - Section A',
        createdAt: cloudDate(data.createdAtISO || data.createdAt),
        expiresAt: cloudDate(data.expiresAtISO || data.expiresAt),
        endedAt: data.endedAtISO || cloudDate(data.endedAt, null),
        status: data.status === 'Live' ? 'Live' : 'Ended',
        checkins: [],
        absencesFinalized: data.absencesFinalized === true
      };
    });
    const currentIds = new Set(cloudSessions.map((item) => item.id));
    for (const [sessionId, unsub] of cloudAttendanceUnsubs.entries()) {
      if (!currentIds.has(sessionId)) { unsub(); cloudAttendanceUnsubs.delete(sessionId); cloudAttendanceBySession.delete(sessionId); }
    }
    state.sessions = cloudSessions.sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
    for (const session of cloudSessions) {
      if (auth.role === 'teacher' && !cloudAttendanceUnsubs.has(session.id)) {
        const unsub = onSnapshot(collection(firebaseDb, 'sessions', session.id, 'attendance'), (attendanceSnap) => {
          const items = attendanceSnap.docs.map((d) => ({ id:d.id, ...d.data() }));
          cloudAttendanceBySession.set(session.id, items);
          rebuildCloudRecords();
        }, (error) => console.error('Attendance live-list sync failed:', error));
        cloudAttendanceUnsubs.set(session.id, unsub);
      } else if (auth.role === 'student' && !cloudAttendanceUnsubs.has(session.id)) {
        const attendanceRef = doc(firebaseDb, 'sessions', session.id, 'attendance', auth.uid);
        const unsub = onSnapshot(attendanceRef, (attendanceSnap) => {
          cloudAttendanceBySession.set(session.id, attendanceSnap.exists() ? [{ id: auth.uid, ...attendanceSnap.data() }] : []);
          rebuildCloudRecords();
        }, (error) => console.error('Student attendance sync failed:', error));
        cloudAttendanceUnsubs.set(session.id, unsub);
      }
    }
    renderAll();
  }, (error) => { console.error('Firestore sessions sync failed:', error); toast('Could not sync sessions with Firebase. Check Firestore rules.', 'alert-circle'); });
}

function rebuildCloudRecords() {
  const records = [];
  for (const [sessionId, entries] of cloudAttendanceBySession.entries()) {
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session) continue;
    session.checkins = entries.map((entry) => entry.studentId || entry.studentUid || entry.id);
    for (const entry of entries) {
      const studentId = entry.studentId || entry.studentUid || entry.id;
      const student = state.students.find((item) => item.id === studentId || item.roll === entry.rollNumber);
      records.push({
        id: `${sessionId}_${entry.id}`,
        studentId: student?.id || studentId,
        sessionId,
        subject: session.subject,
        status: entry.status === 'Present' ? 'Present' : 'Absent',
        timestamp: cloudDate(entry.timestampISO || entry.timestamp)
      });
    }
  }
  state.records = records;
  renderAll();
}

async function createCloudSession(session) {
  await setDoc(doc(firebaseDb, 'sessions', session.id), {
    subject: session.subject,
    className: session.className,
    createdAtISO: session.createdAt,
    expiresAtISO: session.expiresAt,
    status: 'Live',
    teacherUid: auth.uid,
    createdAt: serverTimestamp(),
    checkins: []
  });
}

async function endCloudSession(session) {
  if (!session) return;
  await updateDoc(doc(firebaseDb, 'sessions', session.id), {
    status: 'Ended', endedAtISO: now().toISOString(), endedAt: serverTimestamp()
  });
}

function atToday(hour, minute = 0, dayOffset = 0) {
  const d = now();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function seedState() {
  const students = seedStudents.map((student) => ({ ...student }));
  const sessionDefs = [
    { id: 'AX-742810', subject: 'Database Management Systems', hour: 9, minute: 0, dayOffset: 0, presentCount: 10 },
    { id: 'AX-742811', subject: 'Operating Systems', hour: 10, minute: 30, dayOffset: 0, presentCount: 9 },
    { id: 'AX-742812', subject: 'Java Programming', hour: 12, minute: 15, dayOffset: 0, presentCount: 11 },
    { id: 'AX-742813', subject: 'Computer Networks', hour: 11, minute: 0, dayOffset: -1, presentCount: 8 }
  ];

  const sessions = sessionDefs.map((def) => {
    const createdAt = atToday(def.hour, def.minute, def.dayOffset);
    const checkins = students.slice(0, def.presentCount).map((student) => student.id);
    return {
      id: def.id,
      subject: def.subject,
      className: 'BCA - Section A',
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 5 * 60000).toISOString(),
      endedAt: new Date(createdAt.getTime() + 5 * 60000).toISOString(),
      status: 'Ended',
      checkins,
      absencesFinalized: true
    };
  });

  const records = [];
  sessions.forEach((session, sessionIndex) => {
    students.forEach((student, studentIndex) => {
      const present = session.checkins.includes(student.id);
      const timestamp = new Date(new Date(session.createdAt).getTime() + Math.min(studentIndex, 5) * 25000);
      records.push({
        id: `REC${sessionIndex}${studentIndex}`,
        studentId: student.id,
        sessionId: session.id,
        subject: session.subject,
        status: present ? 'Present' : 'Absent',
        timestamp: timestamp.toISOString()
      });
    });
  });

  return {
    version: STATE_VERSION,
    students,
    subjects: seedSubjects.map((subject) => ({ ...subject })),
    sessions,
    records,
    chartRange: 'week'
  };
}

function normalizeState(input) {
  const fallback = seedState();
  if (!input || typeof input !== 'object') return fallback;

  const students = Array.isArray(input.students) && input.students.length ? input.students : fallback.students;
  const subjectInput = Array.isArray(input.subjects) ? input.subjects : fallback.subjects;
  const sessions = Array.isArray(input.sessions) ? input.sessions : fallback.sessions;
  const records = Array.isArray(input.records) ? input.records : fallback.records;
  const subjects = subjectInput.map((subject, index) => ({
    id: subject.id || `SUB${index + 1}`,
    name: String(subject.name || '').trim(),
    code: String(subject.code || `SUB-${index + 1}`).trim(),
    description: String(subject.description || '').trim(),
    teacher: String(subject.teacher || 'Unassigned').trim()
  })).filter((subject) => subject.name);

  if (!Array.isArray(input.subjects)) {
    sessions.forEach((session) => {
      const name = String(session.subject || '').trim();
      if (name && !subjects.some((subject) => subject.name.toLowerCase() === name.toLowerCase())) {
        subjects.push({
          id: `SUB-${uid()}`,
          name,
          code: `SUB-${subjects.length + 1}`,
          description: '',
          teacher: 'Unassigned'
        });
      }
    });
  }

  return {
    version: STATE_VERSION,
    students: students.map((student, index) => ({
      id: student.id || `STU${index + 1}`,
      name: student.name || 'Unnamed student',
      roll: student.roll || `BCA${String(index + 1).padStart(4, '0')}`,
      course: student.course || 'BCA',
      semester: student.semester || '4th',
      email: student.email || ''
    })),
    subjects,
    sessions: sessions.map((session) => ({
      id: session.id || `AX-${uid()}`,
      subject: session.subject || 'Untitled subject',
      className: session.className || 'BCA - Section A',
      createdAt: session.createdAt || now().toISOString(),
      expiresAt: session.expiresAt || new Date(Date.now() + 5 * 60000).toISOString(),
      endedAt: session.endedAt || null,
      status: session.status === 'Live' ? 'Live' : 'Ended',
      checkins: Array.isArray(session.checkins) ? [...new Set(session.checkins)] : [],
      absencesFinalized: Boolean(session.absencesFinalized)
    })),
    records: records.map((record) => ({
      id: record.id || `REC${uid()}`,
      studentId: record.studentId,
      sessionId: record.sessionId,
      subject: record.subject || sessionById(record.sessionId, fallback).subject,
      status: record.status === 'Absent' ? 'Absent' : 'Present',
      timestamp: record.timestamp || now().toISOString()
    })).filter((record) => record.studentId && record.sessionId),
    chartRange: input.chartRange === 'month' ? 'month' : 'week'
  };
}

function loadState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return seedState();
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadAuth() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_KEY));
    if (saved?.role === 'teacher') return saved;
    if (saved?.role === 'student' && saved.studentId) return saved;
  } catch {
    return null;
  }
  return null;
}

function saveAuth(nextAuth) {
  auth = nextAuth;
  localStorage.setItem(AUTH_KEY, JSON.stringify(nextAuth));
}

function clearAuth() {
  auth = null;
  localStorage.removeItem(AUTH_KEY);
}

function showLogin() {
  window.location.href = 'index.html';
}

function showLoginChoices() {
  $('loginChoice').classList.remove('hidden');
  $('loginForms').classList.add('hidden');
  $('teacherLoginForm').classList.add('hidden');
  $('studentLoginForm').classList.add('hidden');
  $('loginTitle').textContent = 'Choose your login';
  $('loginDescription').textContent = 'Select your portal to continue to AttendX.';
  icons();
}

function showLoginForm(role) {
  $('loginChoice').classList.add('hidden');
  $('loginForms').classList.remove('hidden');
  $('teacherLoginForm').classList.toggle('hidden', role !== 'teacher');
  $('studentLoginForm').classList.toggle('hidden', role !== 'student');
  $('loginTitle').textContent = role === 'teacher' ? 'Teacher Login' : 'Student Login';
  $('loginDescription').textContent = role === 'teacher'
    ? 'Enter your teacher details to access the management portal.'
    : 'Enter your registered student details to access your attendance.';
  if (role === 'teacher') $('teacherEmail').focus();
  else $('studentEmail').focus();
  icons();
}

function showTeacherPortal() {
  $('loginScreen').classList.add('hidden');
  $('studentPortal').classList.add('hidden');
  $('teacherPortal').classList.remove('hidden');
  $('greetingName').textContent = 'Teacher';
  renderAll();
  icons();
}

function showStudentPortal() {
  $('loginScreen').classList.add('hidden');
  $('teacherPortal').classList.add('hidden');
  $('studentPortal').classList.remove('hidden');
  renderStudentPortal();
  icons();
}


async function logout() {
  if (PAGE === 'student') {
    stopStudentScanner(false);
  }

  if (PAGE === 'teacher') {
    stopScanner(false);
  }

  clearAuth();
  try { await signOut(firebaseAuth); } catch (error) { console.error('Firebase sign-out failed:', error); }
  window.location.href = 'index.html';
}


function icons() {
  if (window.lucide) lucide.createIcons();
}

function toast(message, icon = 'check-circle-2') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<i data-lucide="${icon}"></i><span>${escapeHtml(message)}</span>`;
  $('toastContainer').append(el);
  icons();
  setTimeout(() => el.remove(), 3300);
}

function sessionById(id, source = state) {
  return source.sessions.find((session) => session.id === id) || {
    id,
    subject: 'Unknown subject',
    className: 'BCA - Section A',
    checkins: [],
    status: 'Ended'
  };
}

function studentById(id) {
  return state.students.find((student) => student.id === id) || {
    name: 'Unknown student',
    roll: '-',
    course: '-',
    semester: '-',
    email: ''
  };
}

function studentByRoll(roll) {
  const normalized = String(roll || '').trim().toUpperCase();
  return state.students.find((student) => student.roll.toUpperCase() === normalized);
}

function statusBadge(status) {
  const className = status === 'Present'
    ? 'status-present'
    : status === 'Absent'
      ? 'status-absent'
      : status === 'Live'
        ? 'status-live'
        : 'status-ended';
  return `<span class="status-pill ${className}">${escapeHtml(status)}</span>`;
}

function studentCell(student) {
  return `<div class="student-cell"><span class="student-avatar">${escapeHtml(initials(student.name))}</span><span><span class="student-name">${escapeHtml(student.name)}</span><span class="student-email">${escapeHtml(student.email || 'No email added')}</span></span></div>`;
}

function isExpired(session) {
  return new Date(session.expiresAt).getTime() <= Date.now();
}

function formatRemaining(session) {
  const remaining = Math.max(0, new Date(session.expiresAt).getTime() - Date.now());
  const minutes = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function getLiveSessions() {
  syncExpiredSessions();
  return state.sessions
    .filter((session) => session.status === 'Live' && !isExpired(session))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function recordExists(studentId, sessionId, status = null) {
  return state.records.some((record) => (
    record.studentId === studentId &&
    record.sessionId === sessionId &&
    (!status || record.status === status)
  ));
}

function finalizeSession(session, endedAt = now().toISOString()) {
  if (!session || session.status !== 'Live') return false;

  session.status = 'Ended';
  session.endedAt = endedAt;

  if (!session.absencesFinalized) {
    state.students.forEach((student) => {
      if (!recordExists(student.id, session.id)) {
        state.records.push({
          id: `REC${uid()}`,
          studentId: student.id,
          sessionId: session.id,
          subject: session.subject,
          status: 'Absent',
          timestamp: endedAt
        });
      }
    });
    session.absencesFinalized = true;
  }

  if (activeSessionId === session.id) activeSessionId = null;
  return true;
}

function syncExpiredSessions(shouldSave = true) {
  let changed = false;
  state.sessions.forEach((session) => {
    if (session.status === 'Live' && isExpired(session)) {
      changed = finalizeSession(session, session.expiresAt) || changed;
    }
  });
  if (changed && shouldSave) save();
  return changed;
}

function buildQrPayload(session) {
  return session.id;
}

function parseSessionInput(value) {
  const input = String(value || '').trim();
  if (!input) return '';

  try {
    const parsed = JSON.parse(input);
    if (parsed && parsed.sessionId) return String(parsed.sessionId).trim();
  } catch {
    // Fall through to plain session ID parsing.
  }

  try {
    const url = new URL(input);
    return url.searchParams.get('sessionId') || url.searchParams.get('session') || input;
  } catch {
    return input;
  }
}

function setCheckinStatus(label, className = 'status-idle') {
  $('checkinStatus').className = `status-pill ${className}`;
  $('checkinStatus').textContent = label;
}

function renderDashboard() {
  syncExpiredSessions();

  const todayKey = now().toDateString();
  const todayRecords = state.records.filter((record) => new Date(record.timestamp).toDateString() === todayKey);
  const presentToday = new Set(todayRecords.filter((record) => record.status === 'Present').map((record) => record.studentId)).size;
  const latestTodaySession = state.sessions
    .filter((session) => new Date(session.createdAt).toDateString() === todayKey && session.status === 'Ended')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const absentToday = latestTodaySession
    ? state.records.filter((record) => record.sessionId === latestTodaySession.id && record.status === 'Absent').length
    : Math.max(0, state.students.length - presentToday);

  $('statStudents').textContent = state.students.length;
  $('statPresent').textContent = presentToday;
  $('statAbsent').textContent = absentToday;
  $('presentRate').textContent = `${state.students.length ? Math.round((presentToday / state.students.length) * 100) : 0}% of roster`;
  $('statSessions').textContent = String(state.sessions.length).padStart(2, '0');

  renderChart();
  renderRecentSessions();
  renderRecentRecords();
  icons();
}

function renderChart() {
  const range = $('chartRange').value;
  const today = now();
  const labels = range === 'month' ? ['W1', 'W2', 'W3', 'W4'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const buckets = labels.map(() => ({ present: 0, total: 0 }));

  state.records.forEach((record) => {
    const d = new Date(record.timestamp);
    let index;
    if (range === 'month') {
      if (d.getMonth() !== today.getMonth() || d.getFullYear() !== today.getFullYear()) return;
      index = Math.min(3, Math.floor((d.getDate() - 1) / 7));
    } else {
      const mondayIndex = (d.getDay() + 6) % 7;
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      if (d < weekStart || d >= weekEnd) return;
      index = mondayIndex;
    }
    buckets[index].total += 1;
    if (record.status === 'Present') buckets[index].present += 1;
  });

  const values = buckets.map((bucket) => bucket.total ? Math.round((bucket.present / bucket.total) * 100) : 0);
  const nonZero = values.filter(Boolean);
  $('chartRate').textContent = `${nonZero.length ? (nonZero.reduce((sum, value) => sum + value, 0) / nonZero.length).toFixed(1) : '0.0'}%`;
  $('barChart').innerHTML = values.map((value, index) => (
    `<div class="bar-item"><div class="bar" style="height:${Math.max(value, 5)}%" title="${value}%"></div><span class="bar-label">${labels[index]}</span></div>`
  )).join('');
}

function renderRecentSessions() {
  const sessions = [...state.sessions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
  $('recentSessions').innerHTML = sessions.length ? sessions.map((session) => (
    `<div class="recent-item"><span class="subject-icon"><i data-lucide="book-open"></i></span><div class="recent-copy"><b>${escapeHtml(session.subject)}</b><span>${escapeHtml(session.className)} - ${timeFmt.format(new Date(session.createdAt))}</span></div><div class="recent-meta"><b>${session.checkins.length} students</b><span>${statusBadge(session.status)}</span></div></div>`
  )).join('') : '<div class="empty-state">No sessions yet. Start your first session.</div>';
}

function renderRecentRecords() {
  const records = [...state.records].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 5);
  $('recentRecords').innerHTML = records.length ? records.map((record) => {
    const student = studentById(record.studentId);
    return `<tr><td>${studentCell(student)}</td><td>${escapeHtml(record.subject)}</td><td>${fullDateFmt.format(new Date(record.timestamp))}</td><td>${statusBadge(record.status)}</td></tr>`;
  }).join('') : '<tr><td colspan="4">No records yet.</td></tr>';
}

function renderStudents() {
  const query = ($('studentSearch').value || '').toLowerCase();
  const courseFilter = $('studentCourseFilter').value;
  const semesterFilter = $('studentSemesterFilter').value;
  const courses = [...new Set(state.students.map((student) => student.course).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const semesters = [...new Set(state.students.map((student) => student.semester).filter(Boolean))].sort((a, b) => {
    const semesterOrder = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
    return semesterOrder.indexOf(a) - semesterOrder.indexOf(b);
  });
  const setFilterOptions = (select, values, label, selected) => {
    select.innerHTML = `<option value="all">All ${label}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
    if (values.includes(selected)) select.value = selected;
  };
  setFilterOptions($('studentCourseFilter'), courses, 'courses', courseFilter);
  setFilterOptions($('studentSemesterFilter'), semesters, 'semesters', semesterFilter);

  const students = state.students.filter((student) => (
    [student.name, student.roll, student.course, student.email].join(' ').toLowerCase().includes(query) &&
    (courseFilter === 'all' || student.course === courseFilter) &&
    (semesterFilter === 'all' || student.semester === semesterFilter)
  ));

  $('studentCount').textContent = `${students.length} student${students.length === 1 ? '' : 's'}`;
  $('studentEmpty').classList.toggle('hidden', students.length > 0);
  $('studentsTable').innerHTML = students.map((student) => {
    const selected = student.id === selectedStudentId;
    return `<div class="student-list-item${selected ? ' active' : ''}">
      <button class="student-select" data-student-id="${escapeHtml(student.id)}" type="button" aria-pressed="${selected}">
        <span class="student-list-avatar">${escapeHtml(initials(student.name))}</span>
        <span class="student-list-copy"><b>${escapeHtml(student.name)}</b><small>${escapeHtml(student.roll)} · ${escapeHtml(student.course)} · ${escapeHtml(student.semester)} semester</small></span>
      </button>
      <span class="student-list-actions">
        <button class="icon-button edit-student" data-id="${escapeHtml(student.id)}" type="button" title="Edit ${escapeHtml(student.name)}" aria-label="Edit ${escapeHtml(student.name)}"><i data-lucide="pencil"></i></button>
        <button class="icon-button delete-btn delete-student" data-id="${escapeHtml(student.id)}" type="button" title="Delete ${escapeHtml(student.name)}" aria-label="Delete ${escapeHtml(student.name)}"><i data-lucide="trash-2"></i></button>
      </span>
    </div>`;
  }).join('');
  const selectedStudent = students.find((student) => student.id === selectedStudentId);
  if (selectedStudent) renderStudentDetail(selectedStudent);
  else {
    selectedStudentId = null;
    $('studentDetail').classList.add('hidden');
    $('studentDetail').innerHTML = '';
  }
  icons();
}

function renderStudentDetail(student) {
  const completedSessions = state.sessions.filter((session) => session.status === 'Ended');
  const completedSessionIds = new Set(completedSessions.map((session) => session.id));
  const studentRecords = state.records.filter((record) => record.studentId === student.id);
  const presentCount = studentRecords.filter((record) => (
    completedSessionIds.has(record.sessionId) && record.status === 'Present'
  )).length;
  const attendanceRate = completedSessions.length
    ? Math.round((presentCount / completedSessions.length) * 100)
    : 0;
  const subjectNames = [...new Set([
    ...state.subjects.map((subject) => subject.name),
    ...state.sessions.map((session) => session.subject)
  ])];
  const subjectPerformance = subjectNames.map((subjectName) => {
    const sessions = completedSessions.filter((session) => session.subject === subjectName);
    const sessionIds = new Set(sessions.map((session) => session.id));
    const present = studentRecords.filter((record) => sessionIds.has(record.sessionId) && record.status === 'Present').length;
    const rate = sessions.length ? Math.round((present / sessions.length) * 100) : 0;
    return { subjectName, present, total: sessions.length, rate };
  });

  $('studentDetail').classList.remove('hidden');
  $('studentDetail').innerHTML = `
    <div class="student-detail-heading">
      <div class="student-detail-identity">
        <span class="student-detail-avatar">${escapeHtml(initials(student.name))}</span>
        <div><div class="eyebrow">STUDENT PROFILE</div><h2>${escapeHtml(student.name)}</h2><p>${escapeHtml(student.roll)} · ${escapeHtml(student.course)} · ${escapeHtml(student.semester)} semester</p></div>
      </div>
      <button class="icon-button edit-student" data-id="${escapeHtml(student.id)}" type="button" title="Edit student" aria-label="Edit student"><i data-lucide="pencil"></i></button>
    </div>
    <div class="student-performance-summary">
      <div><b>${attendanceRate}%</b><span>Overall attendance</span></div>
      <div><b>${presentCount}/${completedSessions.length}</b><span>Sessions attended</span></div>
      <div><b>${escapeHtml(student.semester)}</b><span>Semester</span></div>
    </div>
    <div class="student-subject-performance">
      <h3>Subject-wise performance</h3>
      ${subjectPerformance.length ? subjectPerformance.map(({ subjectName, present, total, rate }) => `
        <div class="student-performance-row">
          <div class="student-performance-label"><b>${escapeHtml(subjectName)}</b><span>${present}/${total} classes · ${rate}%</span></div>
          <div class="student-performance-track"><span style="width:${rate}%"></span></div>
        </div>`).join('') : '<div class="student-performance-empty">No subjects or sessions available yet.</div>'}
    </div>`;
  icons();
}

function renderSubjects() {
  $('subjectGrid').innerHTML = state.subjects.length ? state.subjects.map((subject) => (
    `<article class="subject-card">
      <span class="subject-code">${escapeHtml(subject.code)}</span>
      <div class="subject-icon-card"><i data-lucide="book-open-check"></i></div>
      <h2>${escapeHtml(subject.name)}</h2>
      <p>${escapeHtml(subject.description || 'No subject description added.')}</p>
      <div class="teacher-strip"><span>Teacher</span><b>${escapeHtml(subject.teacher || 'Unassigned')}</b></div>
      <div class="subject-actions">
        <button class="btn btn-secondary edit-subject" data-id="${escapeHtml(subject.id)}" type="button"><i data-lucide="pencil"></i> Edit</button>
        <button class="btn btn-danger-soft delete-subject" data-id="${escapeHtml(subject.id)}" type="button"><i data-lucide="trash-2"></i> Delete</button>
      </div>
    </article>`
  )).join('') : '<div class="empty-state">No subjects added yet. Add a subject to create QR sessions.</div>';

  const selectedSubjectId = $('sessionSubject').value;
  $('sessionSubject').innerHTML = state.subjects.length
    ? `<option value="">Select a subject</option>${state.subjects.map((subject) => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}</option>`).join('')}`
    : '<option value="">No subjects available — add one in Subjects</option>';
  if (state.subjects.some((subject) => subject.id === selectedSubjectId)) {
    $('sessionSubject').value = selectedSubjectId;
  }
  $('createSessionBtn').disabled = state.subjects.length === 0;
  icons();
}

function renderSessions() {
  syncExpiredSessions();

  const sessions = [...state.sessions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  $('sessionsTable').innerHTML = sessions.length ? sessions.map((session) => {
    const live = session.status === 'Live' && !isExpired(session);
    const actions = live
      ? `<div class="action-buttons"><button class="icon-button open-session" data-id="${session.id}" title="Open QR"><i data-lucide="qr-code"></i></button><button class="icon-button use-session" data-id="${session.id}" title="Use for check-in"><i data-lucide="scan-line"></i></button><button class="icon-button delete-btn close-session" data-id="${session.id}" title="End session"><i data-lucide="square"></i></button></div>`
      : `<button class="text-button view-session-records" data-id="${session.id}">Records <i data-lucide="arrow-right"></i></button>`;
    return `<tr><td><b>${escapeHtml(session.id)}</b></td><td>${escapeHtml(session.subject)}</td><td>${dateFmt.format(new Date(session.createdAt))}</td><td>${session.checkins.length}</td><td>${statusBadge(session.status)}</td><td>${actions}</td></tr>`;
  }).join('') : '<tr><td colspan="6">No sessions created yet.</td></tr>';
  icons();
}

function renderRecords() {
  const query = ($('recordSearch').value || '').toLowerCase();
  const status = $('recordStatus').value;
  const records = [...state.records]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .filter((record) => {
      const student = studentById(record.studentId);
      return [student.name, student.roll, record.subject, record.sessionId].join(' ').toLowerCase().includes(query) &&
        (status === 'all' || record.status === status);
    });

  $('recordsEmpty').classList.toggle('hidden', records.length > 0);
  $('recordsTable').innerHTML = records.map((record) => {
    const student = studentById(record.studentId);
    return `<tr><td>${studentCell(student)}</td><td>${escapeHtml(student.roll)}</td><td>${escapeHtml(record.subject)}</td><td>${fullDateFmt.format(new Date(record.timestamp))}</td><td>${statusBadge(record.status)}</td></tr>`;
  }).join('');
  icons();
}

function renderCheckin() {
  if (!$('checkinStudent')) return;

  const currentStudent = $('checkinStudent').value;
  const liveSessions = getLiveSessions();
  const sessionInput = $('checkinSession');

  $('checkinStudent').innerHTML = state.students.length
    ? state.students.map((student) => `<option value="${student.id}">${escapeHtml(student.roll)} - ${escapeHtml(student.name)}</option>`).join('')
    : '<option value="">No students available</option>';

  if (state.students.some((student) => student.id === currentStudent)) {
    $('checkinStudent').value = currentStudent;
  }

  if (!sessionInput.value && liveSessions.length) {
    sessionInput.value = liveSessions[0].id;
  }

  const sessionId = parseSessionInput(sessionInput.value);
  const session = state.sessions.find((item) => item.id === sessionId);

  if (!sessionInput.value) {
    setCheckinStatus('Ready', 'status-idle');
    $('checkinSummary').innerHTML = '<div class="muted-box">Generate a QR session first, then scan or paste its session ID here.</div>';
  } else if (!session) {
    setCheckinStatus('Not found', 'status-absent');
    $('checkinSummary').innerHTML = '<div class="muted-box">No matching session exists in this demo browser.</div>';
  } else if (session.status !== 'Live' || isExpired(session)) {
    setCheckinStatus('Closed', 'status-ended');
    $('checkinSummary').innerHTML = `<div class="session-mini"><b>${escapeHtml(session.subject)}</b><span>${escapeHtml(session.id)} is closed. Ask the teacher for a live QR.</span></div>`;
  } else {
    setCheckinStatus('Live', 'status-live');
    $('checkinSummary').innerHTML = `<div class="session-mini"><b>${escapeHtml(session.subject)}</b><span>${escapeHtml(session.className)} - ${session.checkins.length}/${state.students.length} checked in - ${formatRemaining(session)} left</span></div>`;
  }

  $('liveSessionsList').innerHTML = liveSessions.length ? liveSessions.map((liveSession) => (
    `<button class="live-session-card use-session" data-id="${liveSession.id}"><span><b>${escapeHtml(liveSession.subject)}</b><small>${escapeHtml(liveSession.id)} - ${formatRemaining(liveSession)} left</small></span><i data-lucide="arrow-right"></i></button>`
  )).join('') : '<div class="empty-state">No live sessions. Create one in QR Sessions.</div>';

  icons();
}

function setStudentCheckinStatus(label, className = 'status-idle') {
  $('studentCheckinStatus').className = `status-pill ${className}`;
  $('studentCheckinStatus').textContent = label;
}

function currentStudent() {
  if (auth?.role !== 'student') return null;
  return state.students.find((student) => student.id === auth.studentId) || null;
}

function renderStudentSessionSummary() {
  const sessionInput = $('studentSessionInput');
  const sessionId = parseSessionInput(sessionInput.value);
  const session = state.sessions.find((item) => item.id === sessionId);

  if (!sessionInput.value) {
    setStudentCheckinStatus('Ready', 'status-idle');
    $('studentSessionSummary').innerHTML = '<div class="muted-box">Scan the QR or tap a live session below.</div>';
    return;
  }

  if (!session) {
    setStudentCheckinStatus('Not found', 'status-absent');
    $('studentSessionSummary').innerHTML = '<div class="muted-box">This session ID is not available in the demo browser.</div>';
    return;
  }

  if (session.status !== 'Live' || isExpired(session)) {
    setStudentCheckinStatus('Closed', 'status-ended');
    $('studentSessionSummary').innerHTML = `<div class="session-mini"><b>${escapeHtml(session.subject)}</b><span>${escapeHtml(session.id)} is closed. Ask your teacher for the active QR.</span></div>`;
    return;
  }

  setStudentCheckinStatus('Live', 'status-live');
  $('studentSessionSummary').innerHTML = `<div class="session-mini"><b>${escapeHtml(session.subject)}</b><span>${escapeHtml(session.className)} - ${formatRemaining(session)} left</span></div>`;
}

function showStudentSection(sectionName) {
  const section = document.querySelector(`[data-student-view="${sectionName}"]`);
  if (!section) return;

  document.querySelectorAll('[data-student-view]').forEach((item) => {
    const active = item.dataset.studentView === sectionName;
    item.hidden = !active;
    item.classList.toggle('active', active);
  });
  document.querySelectorAll('[data-student-section]').forEach((button) => {
    const active = button.dataset.studentSection === sectionName;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (sectionName !== 'checkin') stopStudentScanner(false);
  icons();
}

function renderStudentPortal() {
  if (auth?.role !== 'student' || !$('studentPortal')) return;
  syncExpiredSessions();
  $('scannerSecurityNote').classList.toggle('hidden', Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia));

  const student = currentStudent();
  if (!student) {
    clearAuth();
    showLogin();
    return;
  }

  const studentRecords = state.records
    .filter((record) => record.studentId === student.id)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const presentCount = studentRecords.filter((record) => record.status === 'Present').length;
  const absentCount = studentRecords.filter((record) => record.status === 'Absent').length;
  const totalMarked = presentCount + absentCount;

  $('studentHeroName').textContent = student.name;
  $('studentHeroMeta').textContent = `${student.roll} - ${student.course} - ${student.semester} semester`;
  $('studentPresentCount').textContent = presentCount;
  $('studentAbsentCount').textContent = absentCount;
  $('studentAttendanceRate').textContent = `${totalMarked ? Math.round((presentCount / totalMarked) * 100) : 0}%`;
  $('studentHeroInitials').textContent = initials(student.name);

  $('studentProfileName').value = student.name === 'New Student' ? '' : student.name;
  $('studentProfileRoll').value = student.roll;
  $('studentProfileCourse').value = student.course;
  $('studentProfileSemester').value = student.semester;
  $('studentProfileEmail').value = student.email || '';

  const liveSessions = getLiveSessions();
  if (!$('studentSessionInput').value && liveSessions.length) {
    $('studentSessionInput').value = liveSessions[0].id;
  }
  renderStudentSessionSummary();

  $('studentLiveSessions').innerHTML = liveSessions.length ? liveSessions.map((session) => (
    `<button class="live-session-card student-use-session" data-id="${session.id}"><span><b>${escapeHtml(session.subject)}</b><small>${escapeHtml(session.id)} - ${formatRemaining(session)} left</small></span><i data-lucide="arrow-right"></i></button>`
  )).join('') : '<div class="student-empty">No live sessions right now.</div>';

  $('studentRecordList').innerHTML = studentRecords.length ? studentRecords.map((record) => (
    `<div class="student-record-card"><span><b>${escapeHtml(record.subject)}</b><span>${escapeHtml(record.sessionId)} - ${fullDateFmt.format(new Date(record.timestamp))}</span></span>${statusBadge(record.status)}</div>`
  )).join('') : '<div class="student-empty">No attendance records yet.</div>';

  icons();
}

function renderAll() {
  if (PAGE === 'teacher') {
    renderDashboard();
    renderStudents();
    renderSubjects();
    renderSessions();
    renderRecords();
    renderCheckin();
  }
  if (PAGE === 'student') renderStudentPortal();
  icons();
}

function showView(name) {
  syncExpiredSessions();
  if (name !== 'checkin') stopScanner(false);

  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === name));

  const labels = {
    dashboard: 'Dashboard',
    students: 'Students',
    subjects: 'Subjects & teachers',
    sessions: 'QR Sessions',
    checkin: 'Student check-in',
    records: 'Attendance records',
    settings: 'Setup & settings'
  };

  $('breadcrumbTitle').textContent = labels[name] || 'Dashboard';
  $('sidebar').classList.remove('open');

  if (name === 'dashboard') renderDashboard();
  if (name === 'students') renderStudents();
  if (name === 'subjects') renderSubjects();
  if (name === 'sessions') renderSessions();
  if (name === 'checkin') renderCheckin();
  if (name === 'records') renderRecords();
  icons();
}

function hideQrPanel() {
  clearInterval(countdownInterval);
  $('qrLive').classList.add('hidden');
  $('qrPlaceholder').classList.remove('hidden');
  $('sessionStatus').className = 'status-pill status-idle';
  $('sessionStatus').textContent = 'No active session';
}

function showQrForSession(session) {
  activeSessionId = session.id;
  $('qrPlaceholder').classList.add('hidden');
  $('qrLive').classList.remove('hidden');
  $('qrSubjectTitle').textContent = session.subject;
  $('qrClassTitle').textContent = session.className;
  $('qrSessionId').textContent = session.id;
  $('qrcode').innerHTML = '';

  if (window.QRCode) {
    new QRCode($('qrcode'), {
      text: buildQrPayload(session),
      width: 144,
      height: 144,
      colorDark: '#171c32',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
  } else {
    $('qrcode').innerHTML = '<div class="empty-state">QR library did not load. Enter the session ID manually.</div>';
  }

  $('sessionStatus').className = 'status-pill status-live';
  $('sessionStatus').textContent = 'Session active';
  $('qrFootnote').textContent = 'Demo mode: QR contains a session ID and expiry. Real check-in requires authenticated student validation.';
  startCountdown(session);
  icons();
}

function restoreActiveSession() {
  const liveSession = getLiveSessions()[0];
  if (liveSession) {
    showQrForSession(liveSession);
  } else {
    activeSessionId = null;
    hideQrPanel();
  }
}

function startCountdown(session) {
  clearInterval(countdownInterval);
  const tick = () => {
    if (session.status !== 'Live') {
      hideQrPanel();
      return;
    }

    $('qrCountdown').textContent = formatRemaining(session);

    if (isExpired(session)) {
      finalizeSession(session, session.expiresAt);
      save();
      hideQrPanel();
      renderAll();
      toast('Session expired and absentees were finalized', 'clock-3');
    }
  };
  tick();
  countdownInterval = setInterval(tick, 1000);
}

async function createSession(event) {
  event.preventDefault();
  const selectedSubject = state.subjects.find((item) => item.id === $('sessionSubject').value);
  const className = $('sessionClass').value.trim();
  const minutes = Number($('sessionExpiry').value);
  if (!selectedSubject || !className) { toast('Select a subject and enter a class or section first', 'alert-circle'); return; }
  const currentLive = getLiveSessions()[0];
  if (currentLive) {
    try { await endCloudSession(currentLive); } catch (error) { console.error(error); toast('Could not end the previous Firebase session.', 'alert-circle'); return; }
    finalizeSession(currentLive);
  }
  const createdAt = now();
  const session = { id: `AX-${uid()}-${Date.now().toString(36).slice(-4)}`, subject: selectedSubject.name, className,
    createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + minutes * 60000).toISOString(), endedAt: null,
    status: 'Live', checkins: [], absencesFinalized: false };
  try {
    await createCloudSession(session);
    state.sessions.unshift(session); save(); showQrForSession(session); renderAll(); showView('sessions');
    toast('Live Firebase QR session created', 'qr-code');
  } catch (error) {
    console.error('Could not create Firestore session:', error);
    toast(`Session save failed: ${error.message}`, 'alert-circle');
  }
}

async function endActiveSession(showToast = true) {
  const session = state.sessions.find((item) => item.id === activeSessionId);
  if (session) {
    try { await endCloudSession(session); }
    catch (error) { console.error(error); toast('Could not end session in Firebase.', 'alert-circle'); return; }
    finalizeSession(session);
  }
  activeSessionId = null; save(); hideQrPanel(); renderAll();
  if (showToast) toast('Firebase session ended', 'square');
}

async function markAttendance(studentId, sessionInput) {
  const sessionId = parseSessionInput(sessionInput);
  const student = state.students.find((item) => item.id === studentId) || currentStudent();
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!student) { toast('Student profile not found', 'alert-circle'); return; }
  if (!session) { toast('Session ID not found. Wait for Firebase sessions to sync.', 'alert-circle'); return; }
  if (session.status !== 'Live' || isExpired(session)) { toast('This session is closed', 'alert-circle'); return; }
  if (PAGE === 'student') {
    if (!auth?.uid) { toast('Please log in again.', 'alert-circle'); return; }
    try {
      const attendanceRef = doc(firebaseDb, 'sessions', session.id, 'attendance', auth.uid);
      const existing = await getDoc(attendanceRef);
      if (existing.exists()) { toast('Your attendance is already recorded.', 'info'); return; }
      await setDoc(attendanceRef, {
        studentUid: auth.uid,
        studentId: student.id,
        studentName: student.name,
        rollNumber: student.roll,
        status: 'Present',
        timestampISO: now().toISOString(),
        timestamp: serverTimestamp()
      });
      toast('Attendance saved to Firebase', 'user-check');
    } catch (error) {
      console.error('Firebase attendance write failed:', error);
      toast(`Attendance failed: ${error.message}`, 'alert-circle');
    }
    return;
  }
  if (session.checkins.includes(student.id) || recordExists(student.id, session.id, 'Present')) { toast(`${student.name} is already marked present`, 'info'); return; }
  toast('Teacher manual check-in is not enabled in Firebase phase 3.', 'info');
}

function openStudentModal(student = null) {
  $('studentForm').reset();
  $('editStudentId').value = student?.id || '';
  $('studentModalTitle').textContent = student ? 'Edit student' : 'Add student';
  $('studentName').value = student?.name || '';
  $('studentRoll').value = student?.roll || '';
  $('studentCourse').value = student?.course || 'BCA';
  $('studentSemester').value = student?.semester || '4th';
  $('studentEmail').value = student?.email || '';
  $('studentModal').classList.remove('hidden');
  setTimeout(() => $('studentName').focus(), 50);
}

function closeStudentModal() {
  $('studentModal').classList.add('hidden');
}

function openSubjectModal(subject = null) {
  $('subjectForm').reset();
  $('editSubjectId').value = subject?.id || '';
  $('subjectModalTitle').textContent = subject ? 'Edit subject' : 'Add subject';
  $('subjectName').value = subject?.name || '';
  $('subjectCode').value = subject?.code || '';
  $('subjectTeacher').value = subject?.teacher === 'Unassigned' ? '' : subject?.teacher || '';
  $('subjectDescription').value = subject?.description || '';
  $('subjectModal').classList.remove('hidden');
  setTimeout(() => $('subjectName').focus(), 50);
}

function closeSubjectModal() {
  $('subjectModal').classList.add('hidden');
}

function downloadQR() {
  const canvas = $('qrcode').querySelector('canvas');
  const img = $('qrcode').querySelector('img');
  const url = canvas ? canvas.toDataURL('image/png') : img?.src;

  if (!url) {
    toast('Generate a QR code first', 'alert-circle');
    return;
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = `AttendX-${$('qrSessionId').textContent}.png`;
  a.click();
  toast('QR code downloaded', 'download');
}

function exportCSV() {
  const rows = [
    ['Student name', 'Roll number', 'Subject', 'Session ID', 'Date and time', 'Status'],
    ...state.records.map((record) => {
      const student = studentById(record.studentId);
      return [student.name, student.roll, record.subject, record.sessionId, new Date(record.timestamp).toISOString(), record.status];
    })
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'attendx-attendance-report.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('Attendance report exported', 'download');
}

function resetDemo() {
  if (!confirm('Reset all local demo changes and restore sample data?')) return;
  stopScanner(false);
  clearInterval(countdownInterval);
  state = seedState();
  activeSessionId = null;
  save();
  hideQrPanel();
  renderAll();
  toast('Demo data has been reset', 'rotate-ccw');
}

function fillSessionFromScan(decodedText) {
  $('checkinSession').value = decodedText;
  renderCheckin();
  toast('QR detected. Select student and mark present.', 'scan-line');
}

async function startScanner() {
  if (scannerRunning) return;

  if (!window.Html5Qrcode) {
    $('scanStatus').className = 'status-pill status-absent';
    $('scanStatus').textContent = 'Unavailable';
    toast('Scanner library did not load. Use manual session ID entry.', 'alert-circle');
    return;
  }

  try {
    $('scanStatus').className = 'status-pill status-live';
    $('scanStatus').textContent = 'Starting';
    $('scanPlaceholder').classList.add('hidden');

    qrScanner = qrScanner || new Html5Qrcode('reader');
    await qrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      async (decodedText) => {
        if (!scannerRunning) return;
        fillSessionFromScan(decodedText);
        await stopScanner(false);
      }
    );

    scannerRunning = true;
    $('scanStatus').textContent = 'Scanning';
  } catch (error) {
    scannerRunning = false;
    $('scanPlaceholder').classList.remove('hidden');
    $('scanStatus').className = 'status-pill status-absent';
    $('scanStatus').textContent = 'Blocked';
    toast('Camera access failed. Use manual session ID entry.', 'alert-circle');
  }
}

async function stopScanner(showToast = true) {
  if (!qrScanner || !scannerRunning) {
    $('scanPlaceholder')?.classList.remove('hidden');
    const status = $('scanStatus');
    if (status) {
      status.className = 'status-pill status-idle';
      status.textContent = 'Scanner off';
    }
    return;
  }

  try {
    scannerRunning = false;
    await qrScanner.stop();
    await qrScanner.clear();
    qrScanner = null;
  } catch {
    scannerRunning = false;
    qrScanner = null;
  }

  $('scanPlaceholder')?.classList.remove('hidden');
  const status = $('scanStatus');
  if (status) {
    status.className = 'status-pill status-idle';
    status.textContent = 'Scanner off';
  }
  if (showToast) toast('Scanner stopped', 'camera-off');
}

async function startStudentScanner() {
  if (studentScannerRunning) return;
  showStudentSection('checkin');
  const securityNote = $('scannerSecurityNote');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    securityNote?.classList.remove('hidden');
    $('studentScanStatus').className = 'status-pill status-absent';
    $('studentScanStatus').textContent = 'HTTPS required';
    toast('Phone camera needs HTTPS. Open the secure AttendX link, then allow camera access.', 'lock-keyhole');
    return;
  }
  securityNote?.classList.add('hidden');
  if (!window.Html5Qrcode) {
    $('studentScanStatus').className = 'status-pill status-absent';
    $('studentScanStatus').textContent = 'Unavailable';
    toast('Scanner library did not load. Enter the session ID manually.', 'alert-circle');
    return;
  }
  try {
    $('studentScanStatus').className = 'status-pill status-live';
    $('studentScanStatus').textContent = 'Starting';
    $('studentScanPlaceholder').classList.add('hidden');
    studentScanner = studentScanner || new Html5Qrcode('studentReader');
    await studentScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      async (decodedText) => {
        if (!studentScannerRunning) return;
        $('studentSessionInput').value = decodedText;
        renderStudentSessionSummary();
        toast('QR detected. Review the session and mark your attendance.', 'scan-line');
        await stopStudentScanner(false);
      }
    );
    studentScannerRunning = true;
    $('studentScanStatus').textContent = 'Scanning';
  } catch (error) {
    studentScannerRunning = false;
    $('studentScanPlaceholder').classList.remove('hidden');
    $('studentScanStatus').className = 'status-pill status-absent';
    $('studentScanStatus').textContent = 'Blocked';
    const cameraError = error instanceof Error ? error.message : String(error);
    console.error('Student camera could not start:', error);
    toast(`Camera access failed: ${cameraError}. Check browser permission and try again.`, 'alert-circle');
  }
}

async function stopStudentScanner(showToast = true) {
  if (!studentScanner || !studentScannerRunning) {
    $('studentScanPlaceholder')?.classList.remove('hidden');
    const status = $('studentScanStatus');
    if (status) {
      status.className = 'status-pill status-idle';
      status.textContent = 'Scanner off';
    }
    return;
  }
  try {
    studentScannerRunning = false;
    await studentScanner.stop();
    await studentScanner.clear();
  } catch { /* Camera may already have stopped. */ }
  studentScanner = null;
  $('studentScanPlaceholder').classList.remove('hidden');
  $('studentScanStatus').className = 'status-pill status-idle';
  $('studentScanStatus').textContent = 'Scanner off';
  if (showToast) toast('Scanner stopped', 'camera-off');
}

function useSessionForStudent(sessionId) {
  $('studentSessionInput').value = sessionId;
  showStudentSection('checkin');
  renderStudentSessionSummary();
}

function useSessionForCheckin(sessionId) {
  $('checkinSession').value = sessionId;
  showView('checkin');
  renderCheckin();
}

function bindEvents() {
  on('chooseTeacherLogin', 'click', () => showLoginForm('teacher'));
  on('chooseStudentLogin', 'click', () => showLoginForm('student'));
  document.querySelectorAll('[data-login-back]').forEach((button) => {
    button.addEventListener('click', showLoginChoices);
  });

  on('teacherLoginForm', 'submit', async (event) => {
    event.preventDefault();
    const email = $('teacherEmail').value.trim().toLowerCase();
    const password = $('teacherPassword').value;
    const submitButton = $('teacherLoginForm').querySelector('button[type=submit]');
    if (submitButton) submitButton.disabled = true;
    try {
      const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
      const profileSnap = await getDoc(doc(firebaseDb, 'users', credential.user.uid));
      if (!profileSnap.exists() || profileSnap.data().role !== 'teacher' || profileSnap.data().active === false) {
        await signOut(firebaseAuth);
        toast('This account is not registered as an active teacher. Ask the administrator to check the users profile.', 'alert-circle');
        return;
      }
      saveAuth({ role: 'teacher', uid: credential.user.uid, email: credential.user.email });
      window.location.href = 'teacher.html';
    } catch (error) {
      const messages = {
        'auth/invalid-credential': 'Email or password is incorrect.',
        'auth/user-not-found': 'No Firebase account found for this email.',
        'auth/wrong-password': 'Email or password is incorrect.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/too-many-requests': 'Too many attempts. Try again later.'
      };
      toast(messages[error.code] || `Login failed: ${error.message}`, 'alert-circle');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  on('studentLoginForm', 'submit', async (event) => {
    event.preventDefault();
    const email = $('studentEmail').value.trim().toLowerCase();
    const password = $('studentPassword').value;
    const submitButton = $('studentLoginForm').querySelector('button[type=submit]');
    if (submitButton) submitButton.disabled = true;
    try {
      const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
      const profileSnap = await getDoc(doc(firebaseDb, 'users', credential.user.uid));
      if (!profileSnap.exists() || profileSnap.data().role !== 'student' || profileSnap.data().active === false) {
        await signOut(firebaseAuth);
        toast('This account is not registered as an active student. Ask the administrator to check the users profile.', 'alert-circle');
        return;
      }
      const profile = profileSnap.data();
      const rollNumber = String(profile.rollNumber || profile.roll || '').trim().toUpperCase();
      if (!rollNumber) {
        await signOut(firebaseAuth);
        toast('Student profile is missing rollNumber. Ask the administrator to complete your profile.', 'alert-circle');
        return;
      }
      let student = state.students.find((item) => String(item.roll || '').toUpperCase() === rollNumber);
      if (!student) {
        student = {
          id: credential.user.uid,
          name: profile.name || credential.user.displayName || 'Student',
          roll: rollNumber,
          course: profile.course || 'BCA',
          semester: profile.semester || '1st',
          email: credential.user.email || email,
          photo: profile.photoURL || '',
          attendance: []
        };
        state.students.push(student);
        save();
      }
      saveAuth({ role: 'student', uid: credential.user.uid, email: credential.user.email || email, studentId: student.id, rollNumber });
      window.location.href = 'student.html';
    } catch (error) {
      const messages = {
        'auth/invalid-credential': 'Email or password is incorrect.',
        'auth/user-not-found': 'No Firebase account found for this email.',
        'auth/wrong-password': 'Email or password is incorrect.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/too-many-requests': 'Too many attempts. Try again later.'
      };
      toast(messages[error.code] || `Student login failed: ${error.message}`, 'alert-circle');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  on('studentLogoutBtn', 'click', logout);
  on('signOutBtn', 'click', logout);

  on('studentCheckinForm', 'submit', (event) => {
    event.preventDefault();
    const student = currentStudent();
    if (!student) return logout();
    markAttendance(student.id, $('studentSessionInput').value);
    renderStudentPortal();
  });
  on('studentSessionInput', 'input', renderStudentSessionSummary);
  on('studentStartScannerBtn', 'click', startStudentScanner);
  on('studentStopScannerBtn', 'click', () => stopStudentScanner());
  on('studentLiveSessions', 'click', (event) => {
    const button = event.target.closest('.student-use-session');
    if (button) useSessionForStudent(button.dataset.id);
  });

  on('studentProfileForm', 'submit', (event) => {
    event.preventDefault();
    const student = currentStudent();
    if (!student) return logout();
    student.name = $('studentProfileName').value.trim();
    student.course = $('studentProfileCourse').value.trim();
    student.semester = $('studentProfileSemester').value;
    student.email = $('studentProfileEmail').value.trim();
    save();
    renderAll();
    toast('Profile saved in this browser demo', 'save');
  });

  document.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', () => showView(el.dataset.view)));

  on('menuBtn', 'click', () => $('sidebar').classList.toggle('open'));
  on('closeNotice', 'click', () => $('demoNotice').remove());
  on('helpBtn', 'click', () => showView('settings'));

  on('chartRange', 'change', () => {
    state.chartRange = $('chartRange').value;
    save();
    renderDashboard();
  });
  on('studentSearch', 'input', renderStudents);
  on('studentCourseFilter', 'change', renderStudents);
  on('studentSemesterFilter', 'change', renderStudents);
  on('recordSearch', 'input', renderRecords);
  on('recordStatus', 'change', renderRecords);

  on('addStudentBtn', 'click', () => openStudentModal());
  on('closeStudentModal', 'click', closeStudentModal);
  on('cancelStudentBtn', 'click', closeStudentModal);
  on('studentModal', 'click', (event) => {
    if (event.target === $('studentModal')) closeStudentModal();
  });

  on('studentForm', 'submit', (event) => {
    event.preventDefault();
    const id = $('editStudentId').value;
    const student = {
      id: id || `STU${uid()}`,
      name: $('studentName').value.trim(),
      roll: $('studentRoll').value.trim().toUpperCase(),
      course: $('studentCourse').value.trim(),
      semester: $('studentSemester').value,
      email: $('studentEmail').value.trim()
    };

    if (state.students.some((item) => item.roll.toLowerCase() === student.roll.toLowerCase() && item.id !== id)) {
      toast('That roll number already exists', 'alert-circle');
      return;
    }

    if (id) {
      state.students = state.students.map((item) => item.id === id ? student : item);
      toast('Student updated');
    } else {
      state.students.unshift(student);
      toast('Student added to roster');
    }

    save();
    closeStudentModal();
    renderAll();
  });

  on('studentsTable', 'click', (event) => {
    const edit = event.target.closest('.edit-student');
    const del = event.target.closest('.delete-student');

    if (edit) {
      const student = state.students.find((item) => item.id === edit.dataset.id);
      if (student) openStudentModal(student);
    }

    if (del) {
      const student = state.students.find((item) => item.id === del.dataset.id);
      if (!student) return;
      if (!confirm(`Delete ${student.name} from this demo roster? Related attendance records will also be removed.`)) return;

      state.students = state.students.filter((item) => item.id !== student.id);
      state.records = state.records.filter((record) => record.studentId !== student.id);
      state.sessions.forEach((session) => {
        session.checkins = session.checkins.filter((studentId) => studentId !== student.id);
      });
      save();
      renderAll();
      toast('Student deleted', 'trash-2');
    }
  });

  on('sessionForm', 'submit', createSession);
  on('newSessionBtn', 'click', () => {
    showView('sessions');
    $('sessionSubject').focus();
  });
  on('endSessionBtn', 'click', () => endActiveSession());
  on('downloadQrBtn', 'click', downloadQR);
  on('copySessionId', 'click', async () => {
    try {
      await navigator.clipboard.writeText($('qrSessionId').textContent);
      toast('Session ID copied', 'copy');
    } catch {
      toast('Copy is not available in this browser', 'alert-circle');
    }
  });

  on('sessionsTable', 'click', (event) => {
    const open = event.target.closest('.open-session');
    const use = event.target.closest('.use-session');
    const close = event.target.closest('.close-session');
    const records = event.target.closest('.view-session-records');

    if (open) {
      const session = state.sessions.find((item) => item.id === open.dataset.id);
      if (session && session.status === 'Live') showQrForSession(session);
    }

    if (use) useSessionForCheckin(use.dataset.id);

    if (close) {
      const session = state.sessions.find((item) => item.id === close.dataset.id);
      if (session) {
        finalizeSession(session);
        save();
        hideQrPanel();
        renderAll();
        toast('Session ended and absentees were finalized', 'square');
      }
    }

    if (records) {
      $('recordSearch').value = records.dataset.id;
      showView('records');
    }
  });

  on('checkinForm', 'submit', (event) => {
    event.preventDefault();
    markAttendance($('checkinStudent').value, $('checkinSession').value);
  });
  on('checkinSession', 'input', renderCheckin);
  on('checkinStudent', 'change', renderCheckin);
  on('liveSessionsList', 'click', (event) => {
    const button = event.target.closest('.use-session');
    if (button) useSessionForCheckin(button.dataset.id);
  });
  on('startScannerBtn', 'click', startScanner);
  on('startScannerTopBtn', 'click', startScanner);
  on('stopScannerBtn', 'click', () => stopScanner());

  on('exportCsvBtn', 'click', exportCSV);
  on('resetDemoBtn', 'click', resetDemo);
}

state = loadState();
auth = loadAuth();
syncExpiredSessions();
if (PAGE !== 'login') save();

function bindLoginEvents() {
  on('chooseTeacherLogin', 'click', () => showLoginForm('teacher'));
  on('chooseStudentLogin', 'click', () => showLoginForm('student'));
  document.querySelectorAll('[data-login-back]').forEach((button) => button.addEventListener('click', showLoginChoices));
  on('teacherLoginForm', 'submit', (event) => {
    event.preventDefault();
    const email = $('teacherEmail').value.trim().toLowerCase();
    const password = $('teacherPassword').value;
    if (email !== 'teacher@attendx.demo' || password !== 'teacher123') {
      toast('Demo login: use teacher@attendx.demo / teacher123', 'alert-circle');
      return;
    }
    saveAuth({ role: 'teacher', email });
    window.location.href = 'teacher.html';
  });
  on('studentLoginForm', 'submit', (event) => {
    event.preventDefault();
    const student = studentByRoll($('studentLoginRoll').value);
    if (!student) {
      toast('Roll number not found. Ask the teacher to add you first.', 'alert-circle');
      return;
    }
    saveAuth({ role: 'student', studentId: student.id });
    window.location.href = 'student.html';
  });
}

function bindStudentEvents() {
  document.querySelectorAll('[data-student-section]').forEach((button) => {
    button.addEventListener('click', () => showStudentSection(button.dataset.studentSection));
  });
  on('studentLogoutBtn', 'click', logout);
  on('studentCheckinForm', 'submit', (event) => {
    event.preventDefault();
    const student = currentStudent();
    if (!student) return logout();
    markAttendance(student.id, $('studentSessionInput').value);
    renderStudentPortal();
  });
  on('studentSessionInput', 'input', renderStudentSessionSummary);
  on('studentStartScannerBtn', 'click', startStudentScanner);
  on('studentStopScannerBtn', 'click', () => stopStudentScanner());
  on('studentLiveSessions', 'click', (event) => {
    const button = event.target.closest('.student-use-session');
    if (button) useSessionForStudent(button.dataset.id);
  });
  on('studentProfileForm', 'submit', (event) => {
    event.preventDefault();
    const student = currentStudent();
    if (!student) return logout();
    student.name = $('studentProfileName').value.trim();
    student.course = $('studentProfileCourse').value.trim();
    student.semester = $('studentProfileSemester').value;
    student.email = $('studentProfileEmail').value.trim();
    save();
    renderStudentPortal();
    toast('Profile saved in this browser demo', 'save');
  });
}

function bindTeacherEvents() {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    state = loadState();
    renderAll();
  });
  on('signOutBtn', 'click', logout);
  document.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', () => showView(el.dataset.view)));
  on('menuBtn', 'click', () => $('sidebar')?.classList.toggle('open'));
  on('closeNotice', 'click', () => $('demoNotice')?.remove());
  on('helpBtn', 'click', () => showView('settings'));
  on('chartRange', 'change', () => { state.chartRange = $('chartRange').value; save(); renderDashboard(); });
  on('studentSearch', 'input', renderStudents);
  on('studentCourseFilter', 'change', renderStudents);
  on('studentSemesterFilter', 'change', renderStudents);
  on('recordSearch', 'input', renderRecords);
  on('recordStatus', 'change', renderRecords);
  on('addStudentBtn', 'click', () => openStudentModal());
  on('closeStudentModal', 'click', closeStudentModal);
  on('cancelStudentBtn', 'click', closeStudentModal);
  on('studentModal', 'click', (event) => { if (event.target === $('studentModal')) closeStudentModal(); });
  on('addSubjectBtn', 'click', () => openSubjectModal());
  on('closeSubjectModal', 'click', closeSubjectModal);
  on('cancelSubjectBtn', 'click', closeSubjectModal);
  on('subjectModal', 'click', (event) => { if (event.target === $('subjectModal')) closeSubjectModal(); });
  on('subjectForm', 'submit', (event) => {
    event.preventDefault();
    const id = $('editSubjectId').value;
    const subject = {
      id: id || `SUB-${uid()}`,
      name: $('subjectName').value.trim(),
      code: $('subjectCode').value.trim(),
      description: $('subjectDescription').value.trim(),
      teacher: $('subjectTeacher').value.trim() || 'Unassigned'
    };

    if (state.subjects.some((item) => item.name.toLowerCase() === subject.name.toLowerCase() && item.id !== id)) {
      toast('That subject name already exists', 'alert-circle');
      return;
    }
    if (state.subjects.some((item) => item.code.toLowerCase() === subject.code.toLowerCase() && item.id !== id)) {
      toast('That subject code already exists', 'alert-circle');
      return;
    }

    if (id) {
      state.subjects = state.subjects.map((item) => item.id === id ? subject : item);
      toast('Subject updated');
    } else {
      state.subjects.unshift(subject);
      toast('Subject added');
    }

    save();
    closeSubjectModal();
    renderAll();
  });
  on('subjectGrid', 'click', (event) => {
    const edit = event.target.closest('.edit-subject');
    const del = event.target.closest('.delete-subject');

    if (edit) {
      const subject = state.subjects.find((item) => item.id === edit.dataset.id);
      if (subject) openSubjectModal(subject);
    }

    if (del) {
      const subject = state.subjects.find((item) => item.id === del.dataset.id);
      if (!subject || !confirm(`Delete ${subject.name}? Existing sessions and attendance records will keep their saved subject name.`)) return;
      state.subjects = state.subjects.filter((item) => item.id !== subject.id);
      save();
      renderAll();
      toast('Subject deleted', 'trash-2');
    }
  });
  on('studentForm', 'submit', (event) => {
    event.preventDefault();
    const id = $('editStudentId').value;
    const student = {
      id: id || `STU${uid()}`,
      name: $('studentName').value.trim(),
      roll: $('studentRoll').value.trim().toUpperCase(),
      course: $('studentCourse').value.trim(),
      semester: $('studentSemester').value,
      email: $('studentEmail').value.trim()
    };
    if (state.students.some((item) => item.roll.toLowerCase() === student.roll.toLowerCase() && item.id !== id)) { toast('That roll number already exists', 'alert-circle'); return; }
    if (id) { state.students = state.students.map((item) => item.id === id ? student : item); toast('Student updated'); }
    else { state.students.unshift(student); toast('Student added to roster'); }
    save(); closeStudentModal(); renderAll();
  });
  on('studentsTable', 'click', (event) => {
    const edit = event.target.closest('.edit-student'); const del = event.target.closest('.delete-student');
    const select = event.target.closest('.student-select');
    if (select) {
      selectedStudentId = select.dataset.studentId;
      renderStudents();
      return;
    }
    if (edit) { const student = state.students.find((item) => item.id === edit.dataset.id); if (student) openStudentModal(student); }
    if (del) {
      const student = state.students.find((item) => item.id === del.dataset.id); if (!student) return;
      if (!confirm(`Delete ${student.name} from this demo roster? Related attendance records will also be removed.`)) return;
      state.students = state.students.filter((item) => item.id !== student.id);
      state.records = state.records.filter((record) => record.studentId !== student.id);
      state.sessions.forEach((session) => { session.checkins = session.checkins.filter((studentId) => studentId !== student.id); });
      if (selectedStudentId === student.id) selectedStudentId = null;
      save(); renderAll(); toast('Student deleted', 'trash-2');
    }
  });
  on('studentDetail', 'click', (event) => {
    const edit = event.target.closest('.edit-student');
    if (edit) {
      const student = state.students.find((item) => item.id === edit.dataset.id);
      if (student) openStudentModal(student);
    }
  });
  on('sessionForm', 'submit', createSession);
  on('newSessionBtn', 'click', () => { showView('sessions'); $('sessionSubject')?.focus(); });
  on('endSessionBtn', 'click', () => endActiveSession());
  on('downloadQrBtn', 'click', downloadQR);
  on('copySessionId', 'click', async () => { try { await navigator.clipboard.writeText($('qrSessionId').textContent); toast('Session ID copied', 'copy'); } catch { toast('Copy is not available in this browser', 'alert-circle'); } });
  on('sessionsTable', 'click', (event) => {
    const open = event.target.closest('.open-session'); const use = event.target.closest('.use-session'); const close = event.target.closest('.close-session'); const records = event.target.closest('.view-session-records');
    if (open) { const session = state.sessions.find((item) => item.id === open.dataset.id); if (session && session.status === 'Live') showQrForSession(session); }
    if (use) useSessionForCheckin(use.dataset.id);
    if (close) { const session = state.sessions.find((item) => item.id === close.dataset.id); if (session) { endCloudSession(session).then(() => { finalizeSession(session); save(); hideQrPanel(); renderAll(); toast('Firebase session ended', 'square'); }).catch((error) => toast(`Could not end session: ${error.message}`, 'alert-circle')); } }
    if (records) { $('recordSearch').value = records.dataset.id; showView('records'); }
  });
  on('checkinForm', 'submit', (event) => { event.preventDefault(); markAttendance($('checkinStudent').value, $('checkinSession').value); });
  on('checkinSession', 'input', renderCheckin);
  on('checkinStudent', 'change', renderCheckin);
  on('liveSessionsList', 'click', (event) => { const button = event.target.closest('.use-session'); if (button) useSessionForCheckin(button.dataset.id); });
  on('startScannerBtn', 'click', startScanner);
  on('startScannerTopBtn', 'click', startScanner);
  on('stopScannerBtn', 'click', () => stopScanner());
  on('exportCsvBtn', 'click', exportCSV);
  on('resetDemoBtn', 'click', resetDemo);
}

if (PAGE === 'login') {
  bindEvents();
  if (auth?.role === 'teacher') window.location.replace('teacher.html');
  else if (auth?.role === 'student' && currentStudent()) window.location.replace('student.html');
  else { clearAuth(); showLoginChoices(); }
} else if (PAGE === 'teacher') {
  if (auth?.role !== 'teacher') window.location.replace('index.html');
  else {
    bindTeacherEvents();
    startCloudAttendanceSync();
    $('todayLabel').textContent = `- ${dateFmt.format(now())}`;
    $('greetingName').textContent = 'Teacher';
    $('chartRange').value = state.chartRange;
    restoreActiveSession();
    renderAll();
  }
} else if (PAGE === 'student') {
  if (auth?.role !== 'student' || !currentStudent()) window.location.replace('index.html');
  else { bindStudentEvents(); startCloudAttendanceSync(); renderStudentPortal(); }
}
