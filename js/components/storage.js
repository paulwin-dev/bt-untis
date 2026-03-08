import { openDB } from '../idb.js'

const CUSTOM_DATA_KEY = "custom-data"
const WEEK_CACHE_STORE = "week-cache"
const DEFINITION_KEY = 'timetable-definition'
const STUDENT_NAME_KEY = 'student-name'

let db

export async function init() {
    if (navigator.storage && navigator.storage.persist) {
        const granted = await navigator.storage.persist()
        console.log('Persistent storage:', granted)
    }

    db = await openDB('better-untis', 12, {
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