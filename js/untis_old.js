/**
 * webuntis.js — WebUntis API client module
 *
 * Works with proxy.py (included). All requests go through the local proxy at
 * /proxy/<server>/... so CORS is never an issue.
 *
 * ── QUICK START ────────────────────────────────────────────────────────────
 *
 *   import { login, getTimetable, getAbsences, getGrades, logout } from './webuntis.js';
 *
 *   const session = await login('jfk-schule.webuntis.com', 'jfk-schule', 'user', 'pass');
 *
 *   const { monday, friday, periods } = await getTimetable(session);       // this week
 *   const { periods }                 = await getTimetable(session, -1);   // last week
 *   const { periods }                 = await getTimetable(session, +1);   // next week
 *
 *   const byDay   = groupByDay(periods);   // { 0: [...Mon], 1: [...Tue], ... }
 *   const slots   = getTimeSlots(periods); // sorted unique time rows
 *
 *   const absences = await getAbsences(session);
 *   const grades   = await getGrades(session);
 *
 *   await logout(session);
 *
 * ── SESSION OBJECT ─────────────────────────────────────────────────────────
 *   {
 *     sessionId:  string,
 *     personId:   number,
 *     personType: number,   // 5 = student, 2 = teacher
 *     klasseId:   number,
 *     server:     string,   // e.g. 'jfk-schule.webuntis.com'
 *     school:     string,   // e.g. 'jfk-schule'
 *     username:   string,   // stored for session persistence
 *   }
 */


// ─────────────────────────────────────────────────────────────────────────────
//  Internal transport
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JSON-RPC call via proxy.
 * @param {object|null} session
 * @param {string} method
 * @param {object} [params]
 * @param {string} [serverOverride]
 * @param {string} [schoolOverride]
 */
async function rpc(session, method, params = {}, serverOverride, schoolOverride) {
  const server = serverOverride ?? session?.server;
  const school = schoolOverride ?? session?.school;
  const sid    = session?.sessionId ?? null;

  if (!server || !school) throw new Error('No server/school — call login() first.');

  const path = sid
    ? `jsonrpc.do;jsessionid=${sid}?school=${encodeURIComponent(school)}`
    : `jsonrpc.do?school=${encodeURIComponent(school)}`;

  let resp;
  try {
    resp = await fetch(`/proxy/${server}/${path}`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ id: '1', jsonrpc: '2.0', method, params }),
      credentials: 'include',
    });
  } catch {
    throw new Error('Could not reach proxy.py — is it running?');
  }

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
  return data.result;
}

/**
 * REST GET call via proxy.
 * jsessionid is embedded in the URL path so it works even when
 * the browser blocks third-party cookies.
 * @param {object} session
 * @param {string} path    - relative to /WebUntis/api/
 * @param {object} [params]
 */
async function restGet(session, path, params = {}) {
  const qs  = new URLSearchParams(params).toString();
  const url = `/proxy/${session.server}/api/${path};jsessionid=${session.sessionId}${qs ? '?' + qs : ''}`;

  const resp = await fetch(url, { credentials: 'include' });
  const text = await resp.text();

  // WebUntis returns an HTML redirect page when the session is invalid
  if (text.trimStart().startsWith('<')) {
    throw new Error('Session expired or this endpoint is not enabled for your school.');
  }

  return JSON.parse(text);
}


// ─────────────────────────────────────────────────────────────────────────────
//  Date utilities  (all exported — use them freely in your UI)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the Monday of the week containing `date` (defaults to today).
 * @param {Date} [date]
 * @returns {Date}
 */
export function getMonday(date = new Date()) {
  const d   = new Date(date);
  const day = d.getDay() || 7;     // treat Sunday (0) as day 7
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Add (or subtract) days from a date.
 * @param {Date}   date
 * @param {number} n   — negative to go backwards
 * @returns {Date}
 */
export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Convert a JS Date → Untis date integer.
 * new Date(2025, 2, 5) → 20250305
 * @param {Date} date
 * @returns {number}
 */
export function toUntisDate(date) {
  return (
    date.getFullYear() * 10000 +
    (date.getMonth() + 1) * 100 +
    date.getDate()
  );
}

/**
 * Convert an Untis date integer → JS Date.
 * 20250305 → new Date(2025, 2, 5)
 * @param {number} n
 * @returns {Date}
 */
export function fromUntisDate(n) {
  const s = String(n);
  return new Date(
    parseInt(s.slice(0, 4)),
    parseInt(s.slice(4, 6)) - 1,
    parseInt(s.slice(6, 8)),
  );
}

/**
 * Convert an Untis time integer → "HH:MM" string.
 * 800  → "08:00"
 * 1310 → "13:10"
 * @param {number} t
 * @returns {string}
 */
export function formatTime(t) {
  const s = String(t).padStart(4, '0');
  return `${s.slice(0, 2)}:${s.slice(2)}`;
}


// ─────────────────────────────────────────────────────────────────────────────
//  Auth
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log in and return a session object used by all other functions.
 *
 * @param {string} server    Hostname only — 'jfk-schule.webuntis.com'
 * @param {string} school    Login name shown in WebUntis — 'jfk-schule'
 * @param {string} username
 * @param {string} password
 * @returns {Promise<Session>}
 */
export async function login(server, school, username, password) {
  const proto  = { server, school, sessionId: null };
  const result = await rpc(proto, 'authenticate', {
    user:     username,
    password: password,
    client:   'webuntis-js',
  });

  return {
    sessionId:  result.sessionId,
    personId:   result.personId,
    personType: result.personType,   // 5 = student, 2 = teacher
    klasseId:   result.klasseId,
    server,
    school,
    username,                        // FIX: include username so saveSession can persist it
  };
}

/**
 * End the session. Safe to call even if already expired.
 * @param {Session} session
 */
export async function logout(session) {
  try { await rpc(session, 'logout'); } catch { /* already gone */ }
}


// ─────────────────────────────────────────────────────────────────────────────
//  School year
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the current school year.
 * Mainly used internally, but exported in case you want to display it.
 *
 * @param {Session} session
 * @returns {Promise<{ name: string, startDate: Date, endDate: Date }>}
 */
export async function getCurrentSchoolYear(session) {
  const raw = await rpc(session, 'getCurrentSchoolyear');
  // WebUntis returns startDate/endDate as { year, month, day } objects
  const toDate = o => fromUntisDate(o.year * 10000 + o.month * 100 + o.day);
  return {
    name:      raw.name,
    startDate: toDate(raw.startDate),
    endDate:   toDate(raw.endDate),
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  Timetable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch one week of timetable periods.
 *
 * @param {Session} session
 * @param {number}  [weekOffset=0]  0 = this week, -1 = last week, +1 = next week
 * @returns {Promise<{ monday: Date, friday: Date, periods: Period[] }>}
 *
 * ── PERIOD SHAPE ───────────────────────────────────────────────────────────
 * {
 *   // Raw Untis integers (useful for sorting/comparing)
 *   date:        number,          e.g. 20250305
 *   startTime:   number,          e.g. 800
 *   endTime:     number,          e.g. 845
 *
 *   // Normalised content
 *   subject:     { id, name, longname } | null
 *   teachers:    [{ id, name, longname }]
 *   rooms:       [{ id, name }]
 *   classes:     [{ id, name }]           ← class/Klasse the lesson belongs to
 *   status:      'normal' | 'cancelled' | 'irregular'
 *   info:        string                   ← substitution note or free text
 *   activityType: string
 *
 *   // Pre-computed convenience fields
 *   dateObj:     Date
 *   dayIndex:    number  0=Mon 1=Tue 2=Wed 3=Thu 4=Fri
 *   startStr:    string  "08:00"
 *   endStr:      string  "08:45"
 * }
 */
export async function getTimetable(session, weekOffset = 0) {
  const monday = addDays(getMonday(), weekOffset * 7);
  const friday = addDays(monday, 4);

  const raw = await rpc(session, 'getTimetable', {
    options: {
      startDate:     toUntisDate(monday),
      endDate:       toUntisDate(friday),
      element:       { type: session.personType ?? 5, id: session.personId },
      showSubstText: true,
      showInfo:      true,
      showBooking:   false,
      klasseFields:  ['id', 'name'],
      subjectFields: ['id', 'name', 'longname'],
      teacherFields: ['id', 'name', 'longname'],
      roomFields:    ['id', 'name'],
      klFields:      ['id', 'name'],
    },
  });

  const periods = raw.map(p => {
    const dateObj = fromUntisDate(p.date);
    const dow     = dateObj.getDay();            // 0=Sun … 6=Sat

    return {
      date:      p.date,
      startTime: p.startTime,
      endTime:   p.endTime,

      // WebUntis uses short keys: su=subject, te=teachers, ro=rooms, kl=classes
      subject:  p.su?.[0]
        ? { id: p.su[0].id, name: p.su[0].name, longname: p.su[0].longname ?? p.su[0].name }
        : null,
      teachers: (p.te ?? []).map(t => ({ id: t.id, name: t.name, longname: t.longname ?? t.name })),
      rooms:    (p.ro ?? []).map(r => ({ id: r.id, name: r.name })),
      classes:  (p.kl ?? []).map(k => ({ id: k.id, name: k.name })),

      status:       p.code === 'cancelled' ? 'cancelled'
                  : p.code === 'irregular' ? 'irregular'
                  : 'normal',
      info:         p.substText ?? p.info ?? '',
      activityType: p.activityType ?? '',

      // Convenience
      dateObj,
      dayIndex: dow === 0 ? 6 : dow - 1,   // 0=Mon … 4=Fri, 5=Sat, 6=Sun
      startStr: formatTime(p.startTime),
      endStr:   formatTime(p.endTime),
    };
  });

  periods.sort((a, b) => a.date - b.date || a.startTime - b.startTime);

  return { monday, friday, periods };
}

/**
 * Group an array of periods by day index for easy grid rendering.
 *
 * @param {Period[]} periods
 * @returns {{ 0: Period[], 1: Period[], 2: Period[], 3: Period[], 4: Period[] }}
 *
 * Keys 0–4 = Mon–Fri. Each array is sorted by startTime.
 *
 * Example:
 *   const { periods } = await getTimetable(session);
 *   const byDay = groupByDay(periods);
 *   renderColumn(byDay[0]);  // Monday
 *   renderColumn(byDay[4]);  // Friday
 */
export function groupByDay(periods) {
  const out = { 0: [], 1: [], 2: [], 3: [], 4: [] };
  for (const p of periods) {
    if (p.dayIndex >= 0 && p.dayIndex <= 4) out[p.dayIndex].push(p);
  }
  return out;
}

/**
 * Return the unique sorted time slots across a set of periods.
 * Useful for building a timetable grid where each row = one time slot.
 *
 * @param {Period[]} periods
 * @returns {Array<{ startTime, endTime, startStr, endStr }>}
 *
 * Example:
 *   const slots = getTimeSlots(periods);
 *   // [{ startTime: 800, endTime: 845, startStr: '08:00', endStr: '08:45' }]
 *
 *   for (const slot of slots) {
 *     // render one row
 *     for (let day = 0; day < 5; day++) {
 *       const period = byDay[day].find(p => p.startTime === slot.startTime);
 *       // render cell (may be undefined = free period)
 *     }
 *   }
 */
export function getTimeSlots(periods) {
  const seen = new Map();
  for (const p of periods) {
    if (!seen.has(p.startTime)) seen.set(p.startTime, p.endTime);
  }
  return [...seen.entries()]
    .sort(([a], [b]) => a - b)
    .map(([startTime, endTime]) => ({
      startTime,
      endTime,
      startStr: formatTime(startTime),
      endStr:   formatTime(endTime),
    }));
}


// ─────────────────────────────────────────────────────────────────────────────
//  Absences
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all absences for the current school year.
 *
 * @param {Session} session
 * @returns {Promise<Absence[]>}
 *
 * ── ABSENCE SHAPE ──────────────────────────────────────────────────────────
 * {
 *   date:      Date,
 *   startTime: number,    raw Untis int
 *   endTime:   number,
 *   startStr:  string,    "08:00"
 *   endStr:    string,
 *   subject:   string,    subject name, or '' if unknown
 *   isExcused: boolean,
 *   status:    'excused' | 'unexcused' | 'open',
 * }
 */
export async function getAbsences(session) {
  const year      = await getCurrentSchoolYear(session);
  const startDate = toUntisDate(year.startDate);
  const endDate   = toUntisDate(year.endDate);

  // Different schools expose different endpoint variants
  const candidates = [
    [`classreg/absences/student`,
      { studentId: session.personId, startDate, endDate, includeExcused: true, includeUnExcused: true }],
    [`classreg/absences/students/${session.personId}`,
      { startDate, endDate }],
    [`students/${session.personId}/absences`,
      { startDate, endDate }],
  ];

  let raw = null;
  for (const [path, params] of candidates) {
    try {
      const result = await restGet(session, path, params);
      const arr = result?.absences ?? result?.data ?? result?.result
                ?? (Array.isArray(result) ? result : null);
      if (arr?.length) { raw = arr; break; }
    } catch { /* try next candidate */ }
  }

  if (!raw) return [];

  return raw.map(a => {
    const status = a.isExcused                       ? 'excused'
                 : a.excuseStatus === 'UNEXCUSED'    ? 'unexcused'
                 : 'open';
    return {
      date:      fromUntisDate(a.date),
      startTime: a.startTime,
      endTime:   a.endTime,
      startStr:  formatTime(a.startTime),
      endStr:    formatTime(a.endTime),
      subject:   a.subject?.name ?? a.subjectName ?? '',
      isExcused: !!a.isExcused,
      status,
    };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
//  Grades
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all grades for the current school year.
 *
 * @param {Session} session
 * @returns {Promise<Grade[]>}
 *
 * ── GRADE SHAPE ────────────────────────────────────────────────────────────
 * {
 *   subject:  string,     subject name
 *   value:    string,     e.g. "2", "A", "sehr gut"
 *   label:    string,     test / assignment name
 *   date:     Date|null,
 * }
 */
export async function getGrades(session) {
  const year      = await getCurrentSchoolYear(session);
  const startDate = toUntisDate(year.startDate);
  const endDate   = toUntisDate(year.endDate);

  const candidates = [
    [`classreg/grade/list/student/${session.personId}`, {}],
    [`students/${session.personId}/grades`,             { startDate, endDate }],
    [`classreg/grades`,                                 { personId: session.personId, startDate, endDate }],
  ];

  let raw = null;
  for (const [path, params] of candidates) {
    try {
      const result = await restGet(session, path, params);
      const arr = result?.data ?? result?.grades ?? result?.result
                ?? (Array.isArray(result) ? result : null);
      if (arr?.length) { raw = arr; break; }
    } catch { /* try next candidate */ }
  }

  if (!raw) return [];

  return raw.map(g => ({
    subject: g.subject?.name ?? g.subjectName ?? 'Unknown',
    value:   g.grade?.name  ?? g.mark ?? g.value ?? '—',
    label:   g.gradeType?.name ?? g.text ?? g.description ?? 'Grade',
    date:    g.date ? fromUntisDate(g.date) : null,
  }));
}

// ─────────────────────────────────────────────────────────────
//  Session persistence
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'webuntis_session';

/**
 * Save a session to localStorage so it can be restored after a page reload.
 * Never stores the password — only the session ID and identifiers.
 *
 * @param {Session} session
 */
export function saveSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    server:     session.server,
    school:     session.school,
    sessionId:  session.sessionId,
    personId:   session.personId,
    personType: session.personType,
    klasseId:   session.klasseId,
    username:   session.username,   // now always present since login() sets it
  }));
}

/**
 * Try to restore a session from localStorage and verify it is still valid
 * by making a lightweight API call. Returns null if there is nothing saved
 * or if the session has expired (in which case the stale entry is removed).
 *
 * @returns {Promise<Session|null>}
 *
 * @example
 * const session = await restoreSession();
 * if (session) {
 *   // already logged in
 * } else {
 *   // show login form
 * }
 */
export async function restoreSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  let saved;
  try { saved = JSON.parse(raw); } catch { clearSession(); return null; }

  // Verify the session is still alive with a cheap RPC call
  try {
    await rpc(saved, 'getLatestImportTime'); // FIX: was incorrectly _rpc (with underscore)
    return saved; // still valid
  } catch {
    clearSession(); // expired — clean up so the login form appears next time
    return null;
  }
}

/**
 * Remove the saved session from localStorage.
 * Call this on logout or when you get an auth error.
 */
export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function getTimetableDefinition(session) {
  const result = await restGet(session, 'rest/view/v1/timetable/grid', {
    timetableType: 'MY_TIMETABLE'
  });

  const data = result?.data ?? result;
  
  // pick the format matching studentFormat (4 for students, 2 for teachers)
  const format = data.formatDefinitions.find(f => f.id === data.studentFormat)
               ?? data.formatDefinitions[0];

  return {
    days: format.timeGridDays,   // ['MO','TU','WE','TH','FR']
    slots: format.timeGridSlots.map(s => ({
      number:   s.number,
      start:    s.duration.start,   // "08:00"
      end:      s.duration.end,     // "08:45"
    })),
  };
}