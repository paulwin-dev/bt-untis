/**
 * webuntis.js — WebUntis API client module
 *
 * Uses the modern REST view API (/api/rest/view/v1/timetable/entries) as the
 * primary timetable source. Falls back to the legacy JSON-RPC API for
 * absences and grades which are not available in the new API.
 *
 * All requests go through proxy.py at /proxy/<server>/... to avoid CORS.
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
 *     username:   string,
 *   }
 *
 * ── PERIOD SHAPE ───────────────────────────────────────────────────────────
 *   {
 *     // Time (integers for sorting/grid matching, strings for display)
 *     date:        number,        e.g. 20250305
 *     startTime:   number,        e.g. 800
 *     endTime:     number,        e.g. 937
 *     dateObj:     Date,
 *     dayIndex:    number,        0=Mon … 4=Fri
 *     startStr:    string,        "08:00"
 *     endStr:      string,        "09:37"
 *
 *     // Content
 *     subject:     { name, longname } | null
 *     teachers:    [{ name, longname }]
 *     rooms:       [{ name, longname }]
 *     roomsOld:    [{ name, longname }]   ← previous rooms if changed
 *     classes:     [{ name }]
 *     info:        string                 ← lessonInfo / substitution note
 *
 *     // Status — 'status' keeps old string values for drop-in compatibility
 *     status:        'normal' | 'cancelled' | 'irregular'
 *     type:          'NORMAL_TEACHING_PERIOD' | 'EXAM' | 'EVENT' | string
 *     isExam:        boolean
 *     isCancelled:   boolean
 *     isChanged:     boolean
 *     hasRoomChange: boolean
 *   }
 */


// ─────────────────────────────────────────────────────────────────────────────
//  Internal transport
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JSON-RPC call via proxy. Used for auth, absences, grades.
 */
async function rpc(session, method, params = {}, serverOverride, schoolOverride) {
	const server = serverOverride ?? session?.server;
	const school = schoolOverride ?? session?.school;
	const sid = session?.sessionId ?? null;

	if (!server || !school) throw new Error('No server/school — call login() first.');

	const path = sid
		? `jsonrpc.do;jsessionid=${sid}?school=${encodeURIComponent(school)}`
		: `jsonrpc.do?school=${encodeURIComponent(school)}`;

	let resp;
	try {
		resp = await fetch(`/proxy/${server}/${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: '1', jsonrpc: '2.0', method, params }),
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
 * REST GET via proxy.
 */
async function restGet(session, path, params = {}) {
	const qs = new URLSearchParams(params).toString();
	const url = `/proxy/${session.server}/api/${path}${qs ? '?' + qs : ''}`;

	const headers = { 'X-Untis-Session': session.sessionId };
	if (session.bearerToken) {
		headers['Authorization'] = `Bearer ${session.bearerToken}`;
	}

	const resp = await fetch(url, { headers });
	const text = await resp.text();

	if (text.trimStart().startsWith('<')) {
		throw new Error('Session expired or this endpoint is not enabled for your school.');
	}

	return JSON.parse(text);
}


// ─────────────────────────────────────────────────────────────────────────────
//  Date utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Return the Monday of the week containing `date` (defaults to today). */
export function getMonday(date = new Date()) {
	const d = new Date(date);
	const day = d.getDay() || 7;
	d.setDate(d.getDate() - day + 1);
	d.setHours(0, 0, 0, 0);
	return d;
}

/** Add (or subtract) n days from a date. */
export function addDays(date, n) {
	const d = new Date(date);
	d.setDate(d.getDate() + n);
	return d;
}

/** JS Date → Untis date integer.  new Date(2025,2,5) → 20250305 */
export function toUntisDate(date) {
	return (
		date.getFullYear() * 10000 +
		(date.getMonth() + 1) * 100 +
		date.getDate()
	);
}

/** Untis date integer → JS Date.  20250305 → new Date(2025,2,5) */
export function fromUntisDate(n) {
	const s = String(n);
	return new Date(
		parseInt(s.slice(0, 4)),
		parseInt(s.slice(4, 6)) - 1,
		parseInt(s.slice(6, 8)),
	);
}

/** Untis time integer → "HH:MM" string.  800 → "08:00" */
export function formatTime(t) {
	const s = String(t).padStart(4, '0');
	return `${s.slice(0, 2)}:${s.slice(2)}`;
}

/** "HH:MM" string → Untis time integer.  "08:00" → 800 */
function timeStrToInt(str) {
	const [h, m] = str.split(':');
	return parseInt(h) * 100 + parseInt(m);
}

/** "2026-03-16T08:00" → 800 */
function dtToTimeInt(dt) {
	return timeStrToInt(dt.slice(11, 16));
}

/** "2026-03-16T08:00" → 20260316 */
function dtToDateInt(dt) {
	return parseInt(dt.slice(0, 10).replace(/-/g, ''));
}


// ─────────────────────────────────────────────────────────────────────────────
//  Auth
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log in and return a session object used by all other functions.
 *
 * @param {string} server    Hostname — 'jfk-schule.webuntis.com'
 * @param {string} school    School login name — 'jfk-schule'
 * @param {string} username
 * @param {string} password
 * @returns {Promise<Session>}
 */
export async function login(server, school, username, password) {
	const proto = { server, school, sessionId: null };
	const result = await rpc(proto, 'authenticate', {
		user: username,
		password: password,
		client: 'webuntis-js',
	});

	const session = {
		sessionId: result.sessionId,
		personId: result.personId,
		personType: result.personType,
		klasseId: result.klasseId,
		server,
		school,
		username,
		bearerToken: null,
	};

	// Fetch the Bearer token needed for the new REST view API
	session.bearerToken = await fetchBearerToken(session);

	return session;
}

async function fetchBearerToken(session) {
	const url = `/proxy/${session.server}/api/token/new`;
	const resp = await fetch(url, {
		headers: { 'X-Untis-Session': session.sessionId }
	});
	const text = await resp.text();
	if (!text || text.trimStart().startsWith('<')) return null;
	// Response is just the raw token string or a JSON object with a token field
	try {
		const json = JSON.parse(text);
		return json.token ?? json.access_token ?? json ?? null;
	} catch {
		return text.trim(); // raw token string
	}
}

/** End the session. Safe to call even if already expired. */
export async function logout(session) {
	try { await rpc(session, 'logout'); } catch { /* already gone */ }
}


// ─────────────────────────────────────────────────────────────────────────────
//  School year  (used internally by absences + grades)
// ─────────────────────────────────────────────────────────────────────────────

export async function getCurrentSchoolYear(session) {
	const raw = await rpc(session, 'getCurrentSchoolyear');
	const toDate = o => fromUntisDate(o.year * 10000 + o.month * 100 + o.day);
	return {
		name: raw.name,
		startDate: toDate(raw.startDate),
		endDate: toDate(raw.endDate),
	};
}


// ─────────────────────────────────────────────────────────────────────────────
//  Timetable  (new REST view API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract items from a position array into { current, removed } arrays.
 * Each item is { name: shortName, longname: longName }.
 */
function extractPosition(posArr) {
	if (!posArr?.length) return { current: [], removed: [] };
	const current = posArr
		.filter(p => p.current)
		.map(p => ({ name: p.current.shortName, longname: p.current.longName ?? p.current.shortName }));
	const removed = posArr
		.filter(p => p.removed)
		.map(p => ({ name: p.removed.shortName, longname: p.removed.longName ?? p.removed.shortName }));
	return { current, removed };
}

/**
 * Parse a single gridEntry from the REST view API into a normalised Period.
 */
function parseEntry(entry, dateObj) {
		
	const dow = dateObj.getDay();
	const dayIndex = dow === 0 ? 6 : dow - 1;

	const startTime = dtToTimeInt(entry.duration.start);
	const endTime = dtToTimeInt(entry.duration.end);
	const date = dtToDateInt(entry.duration.start);

	// position1 = teacher, position2 = subject, position3 = room, position4 = class/info
	const teacherPos = extractPosition(entry.position1);
	const subjectPos = extractPosition(entry.position2);
	const roomPos = extractPosition(entry.position3);
	const classPos = extractPosition(entry.position4);

	const subjectEntry = subjectPos.current[0] ?? null;
	const hasRoomChange = roomPos.removed.length > 0;
	const isCancelled = entry.status === 'CANCELLED';
	const isChanged = entry.status === 'CHANGED';
	const isExam = entry.type === 'EXAM';
	const notes = entry.notesAll
	const hasHomework = entry.icons?.includes("HOMEWORK") ?? false

	// For EVENTs the subject position often holds an INFO type with the event name
	const displayName = subjectEntry?.longname ?? subjectEntry?.name ?? null;

	return {
		// Time
		date,
		startTime,
		endTime,
		dateObj,
		dayIndex,
		startStr: formatTime(startTime),
		endStr: formatTime(endTime),

		// Content
		subject: displayName ? { name: subjectEntry.name, longname: subjectEntry.longname } : null,
		teachers: teacherPos.current,
		rooms: roomPos.current,
		roomsOld: roomPos.removed,
		classes: classPos.current,
		info: entry.lessonInfo ?? entry.substitutionText ?? '',

		// Status — same strings as old API for compatibility
		status: isCancelled ? 'cancelled'
			: (isChanged || hasRoomChange) ? 'irregular'
				: 'normal',

		// Rich flags (new)
		type: entry.type,
		isExam,
		isCancelled,
		isChanged,
		hasRoomChange,
		notes,
		hasHomework
	};
}

/**
 * Fetch one week of timetable periods using the modern REST view API.
 *
 * Drop-in replacement for the old getTimetable(). Returns the same shape
 * plus extra fields: isExam, hasRoomChange, roomsOld, isCancelled, isChanged, type.
 *
 * @param {Session} session
 * @param {number}  [weekOffset=0]  0 = this week, ±n = future/past weeks
 * @returns {Promise<{ monday: Date, friday: Date, periods: Period[] }>}
 */
export async function getTimetable(session, weekOffset = 0) {
	const monday = addDays(getMonday(), weekOffset * 7);
	const friday = addDays(monday, 4);

	const fmt = d => {
		const yyyy = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${yyyy}-${mm}-${dd}`;
	};

	const data = await restGet(session, 'rest/view/v1/timetable/entries', {
		start: fmt(monday),
		end: fmt(friday),
		format: 4,
		resourceType: session.personType === 2 ? 'TEACHER' : 'STUDENT',
		resources: session.personId,
		periodTypes: '',
		timetableType: 'MY_TIMETABLE',
		layout: 'START_TIME',
	});

	const days = data?.days ?? [];
	const periods = [];

	for (const day of days) {
		const dateObj = new Date(day.date + 'T00:00:00');
		for (const entry of day.gridEntries ?? []) {
			periods.push(parseEntry(entry, dateObj));
		}
	}

	periods.sort((a, b) => a.date - b.date || a.startTime - b.startTime);

	const dayStatuses = {};
	for (const day of days) {
		dayStatuses[day.date] = {
			status: day.status,
			backEntries: day.backEntries ?? []
		};
	}

	return { monday, friday, periods, dayStatuses };
}

/**
 * Group periods by day index (0=Mon … 4=Fri).
 *
 * @param {Period[]} periods
 * @returns {{ 0: Period[], 1: Period[], 2: Period[], 3: Period[], 4: Period[] }}
 */
export function groupByDay(periods) {
	const out = { 0: [], 1: [], 2: [], 3: [], 4: [] };
	for (const p of periods) {
		if (p.dayIndex >= 0 && p.dayIndex <= 4) out[p.dayIndex].push(p);
	}
	return out;
}

/**
 * Return unique sorted time slots from a set of periods.
 * Use to drive timetable grid rows.
 *
 * @param {Period[]} periods
 * @returns {Array<{ startTime, endTime, startStr, endStr }>}
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
			endStr: formatTime(endTime),
		}));
}

/**
 * Fetch the timetable grid definition — slot times and active days.
 * Useful for showing the full grid even when some slots have no lessons.
 *
 * @param {Session} session
 * @returns {Promise<{ days: string[], slots: Array<{ number, start, end, startInt, endInt }> }>}
 */
export async function getTimetableDefinition(session) {
	const result = await restGet(session, 'rest/view/v1/timetable/grid', {
		timetableType: 'MY_TIMETABLE'
	});

	const data = result?.data ?? result;
	const format = data.formatDefinitions.find(f => f.id === data.studentFormat)
		?? data.formatDefinitions[0];

	return {
		days: format.timeGridDays,
		slots: format.timeGridSlots.map(s => ({
			number: s.number,
			start: s.duration.start,
			end: s.duration.end,
			startInt: timeStrToInt(s.duration.start),
			endInt: timeStrToInt(s.duration.end),
		})),
	};
}


// ─────────────────────────────────────────────────────────────────────────────
//  Grades  (legacy RPC — not available in new REST API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all grades for the current school year.
 *
 * @param {Session} session
 * @returns {Promise<Grade[]>}
 *
 * ── GRADE SHAPE ────────────────────────────────────────────────────────────
 * {
 *   subject:  string,
 *   value:    string,     e.g. "2", "A", "sehr gut"
 *   label:    string,     test / assignment name
 *   date:     Date|null,
 * }
 */
export async function getGrades(session) {
	const year = await getCurrentSchoolYear(session);
	const startDate = toUntisDate(year.startDate);
	const endDate = toUntisDate(year.endDate);

	const candidates = [
		[`classreg/grade/list/student/${session.personId}`, {}],
		[`students/${session.personId}/grades`, { startDate, endDate }],
		[`classreg/grades`, { personId: session.personId, startDate, endDate }],
	];

	let raw = null;
	for (const [path, params] of candidates) {
		try {
			const result = await restGet(session, path, params);
			const arr = result?.data ?? result?.grades ?? result?.result
				?? (Array.isArray(result) ? result : null);
			if (arr?.length) { raw = arr; break; }
		} catch { /* try next */ }
	}

	if (!raw) return [];

	return raw.map(g => ({
		subject: g.subject?.name ?? g.subjectName ?? 'Unknown',
		value: g.grade?.name ?? g.mark ?? g.value ?? '—',
		label: g.gradeType?.name ?? g.text ?? g.description ?? 'Grade',
		date: g.date ? fromUntisDate(g.date) : null,
	}));
}

export function getNameFromToken(session) {
    if (!session.bearerToken) return null
    try {
        const payload = JSON.parse(atob(session.bearerToken.split('.')[1]))
        return payload.username ?? payload.sub ?? null
    } catch {
        return null
    }
}


// ─────────────────────────────────────────────────────────────────────────────
//  Session persistence
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'webuntis_session';

export function saveSession(session, password = null) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify({
		server: session.server,
		school: session.school,
		sessionId: session.sessionId,
		personId: session.personId,
		personType: session.personType,
		klasseId: session.klasseId,
		username: session.username,
		password: password
		// bearer token is NOT saved — it expires and must be refreshed on restore
	}));
}

export function getCachedSesion() {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;

	let saved;
	try { saved = JSON.parse(raw) } catch { return null }

	return saved
}

export async function restoreSession() {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;

	let saved;
	//try { saved = JSON.parse(raw); } catch { clearSession(); return null; }
	try { saved = JSON.parse(raw); } catch { return null; }

	// Verify JSESSIONID is still alive
	try {
		await rpc(saved, 'getLatestImportTime');
	} catch {
		//clearSession();
		return null;
	}

	// Re-fetch the Bearer token since it's not persisted
	saved.bearerToken = await fetchBearerToken(saved);

	return saved;
}

/** Remove saved session from localStorage. */
export function clearSession() {
	localStorage.removeItem(STORAGE_KEY);
}

export async function getPeriodDetails(session, period) {
    const fmt = dt => {
        const yyyy = dt.getFullYear()
        const mm   = String(dt.getMonth() + 1).padStart(2, '0')
        const dd   = String(dt.getDate()).padStart(2, '0')
        const hh   = String(dt.getHours()).padStart(2, '0')
        const min  = String(dt.getMinutes()).padStart(2, '0')
        return `${yyyy}-${mm}-${dd}T${hh}:${min}:00`
    }

    // reconstruct start/end Date objects from period
    const startH = Math.floor(period.startTime / 100)
    const startM = period.startTime % 100
    const endH   = Math.floor(period.endTime / 100)
    const endM   = period.endTime % 100

    const startDate = new Date(period.dateObj)
    startDate.setHours(startH, startM, 0, 0)
    const endDate = new Date(period.dateObj)
    endDate.setHours(endH, endM, 0, 0)

    const data = await restGet(session, 'rest/view/v2/calendar-entry/detail', {
        elementId:     session.personId,
        elementType:   session.personType,
        startDateTime: fmt(startDate),
        endDateTime:   fmt(endDate),
        homeworkOption: 'DUE',
    })

    const entry = data?.calendarEntries?.[0]
    if (!entry) return { homeworks: [], teachingContent: null }

    return {
        homeworks: (entry.homeworks ?? []).map(hw => ({
            id:        hw.id,
            text:      hw.text,
            remark:    hw.remark,
            completed: hw.completed,
            dueDate:   new Date(hw.dueDateTime),
            setDate:   new Date(hw.dateTime),
        })),
        teachingContent: entry.teachingContent ?? null,
    }
}

export async function getAbsences(session) {
    const year = await getCurrentSchoolYear(session)
    const startDate = toUntisDate(year.startDate)
    const endDate   = toUntisDate(year.endDate)

    const result = await restGet(session, 'classreg/absences/students', {
        startDate,
        endDate,
        studentId:      session.personId,
        excuseStatusId: -1,
    })

    const raw = result?.data?.absences ?? []

    return raw.map(a => ({
        id:        a.id,
        date:      fromUntisDate(a.startDate),
        startTime: a.startTime,
        endTime:   a.endTime,
        startStr:  formatTime(a.startTime),
        endStr:    formatTime(a.endTime),
        reason:    a.reason ?? '',
        text:      a.text ?? '',
        isExcused: a.isExcused,
        isLate:    a.reason === 'late',
        excuseStatus: a.excuseStatus ?? null,
    }))
}