import { openDB } from '../idb.js'

const CUSTOM_DATA_KEY = "custom-data"

let db

export async function init() {
    if (navigator.storage && navigator.storage.persist) {
        const granted = await navigator.storage.persist()
        console.log('Persistent storage:', granted)
    }

    db = await openDB('better-untis', 1, {
        upgrade(db) {
            db.createObjectStore(CUSTOM_DATA_KEY, { keyPath: 'id' })
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