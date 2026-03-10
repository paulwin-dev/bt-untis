import { openDB } from '../idb.js'

const CUSTOM_DATA_KEY = "custom-data"
const WEEK_CACHE_STORE = "week-cache"
const API_HW_CACHE = "hw-cache"
const DEFINITION_KEY = 'timetable-definition'
const STUDENT_NAME_KEY = 'student-name'
const HW_COMPLETED_KEY = 'hw-completed'

let db

export async function init() {
    if (navigator.storage && navigator.storage.persist) {
        const granted = await navigator.storage.persist()
        console.log('Persistent storage:', granted)
    }

    db = await openDB('better-untis', 13, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(CUSTOM_DATA_KEY)) {
                db.createObjectStore(CUSTOM_DATA_KEY, { keyPath: 'id' })
            }
            if (!db.objectStoreNames.contains('week-cache')) {
                db.createObjectStore('week-cache', { keyPath: 'week' })
            }
            if (!db.objectStoreNames.contains('config')) {
                db.createObjectStore('config', { keyPath: 'id' })
            }
            if (!db.objectStoreNames.contains(API_HW_CACHE)) {
                db.createObjectStore(API_HW_CACHE, { keyPath: 'id' })
            }
        }
    })
}

export async function putCustomPeriodData(homework = [], note = "", date, startTime) {
    await db.put(CUSTOM_DATA_KEY, {
        id: `${date}-${startTime}`,
        homework: homework,
        note: note,
        updatedAt: Date.now(),
    })
}

export async function setHomeworkCompleted(hwId, completed) {
    const result = await db.get('config', HW_COMPLETED_KEY).catch(() => null)
    const map = result?.value ?? {}
    if (completed) {
        map[hwId] = true
    } else {
        delete map[hwId]
    }
    await db.put('config', { id: HW_COMPLETED_KEY, value: map })
}

export async function getCompletedHomework() {
    const result = await db.get('config', HW_COMPLETED_KEY).catch(() => null)
    return result?.value ?? {}
}

export async function getCustomPeriodData(date, startTime) {
    return await db.get(CUSTOM_DATA_KEY, `${date}-${startTime}`)
}

export async function saveWeekCache(weekOffset, data) {
    await db.put(WEEK_CACHE_STORE, { week: weekOffset, ...data, cachedAt: Date.now() })
}

export async function loadWeekCache(weekOffset) {
    return await db.get(WEEK_CACHE_STORE, weekOffset)
}

export async function saveDefinition(definition) {
    await db.put('config', { id: DEFINITION_KEY, value: definition })
}

export async function loadDefinition() {
    const result = await db.get('config', DEFINITION_KEY)
    return result?.value ?? null
}

export async function saveStudentName(name) {
    await db.put('config', { id: STUDENT_NAME_KEY, value: name })
}

export async function loadStudentName() {
    const result = await db.get('config', STUDENT_NAME_KEY)
    return result?.value ?? null
}

export async function saveHomeworkCache(date, startTime, data) {
    await db.put(API_HW_CACHE, { id: `${date}-${startTime}`, data, cachedAt: Date.now() })
}

export async function loadHomeworkCache(date, startTime) {
    const result = await db.get(API_HW_CACHE, `${date}-${startTime}`).catch(() => null)
    return result?.data ?? null
}