/**
 * idb.js — minimal IndexedDB wrapper matching the idb npm package API
 * Drop-in replacement for: import { openDB } from 'idb'
 *
 * Supports:
 *   openDB(name, version, { upgrade(db) {} })
 *   db.put(store, value)
 *   db.get(store, key)
 *   db.delete(store, key)
 *   db.getAll(store)
 */

export function openDB(name, version, { upgrade } = {}) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, version);

        req.onupgradeneeded = e => {
            try {
                upgrade?.(wrap(e.target.result));
            } catch (err) {
                reject(err);
            }
        };

        req.onsuccess = e => resolve(wrap(e.target.result));
        req.onerror   = e => reject(e.target.error);
        req.onblocked = () => reject(new Error('IndexedDB blocked — close other tabs using this app'));
    });
}

/**
 * Wrap a raw IDBDatabase so it exposes promise-based methods
 * matching the idb package interface.
 */
function wrap(idbDatabase) {
    return {
        put(storeName, value) {
            return tx(idbDatabase, storeName, 'readwrite', s => s.put(value));
        },
        get(storeName, key) {
            return tx(idbDatabase, storeName, 'readonly', s => s.get(key));
        },
        delete(storeName, key) {
            return tx(idbDatabase, storeName, 'readwrite', s => s.delete(key));
        },
        getAll(storeName) {
            return tx(idbDatabase, storeName, 'readonly', s => s.getAll());
        },
        // expose raw db in case you ever need it
        _raw: idbDatabase,

        // mirror IDBDatabase.createObjectStore for use inside upgrade()
        createObjectStore(name, options) {
            return idbDatabase.createObjectStore(name, options);
        },
    };
}

/** Run a single IDBRequest inside a transaction and return a promise. */
function tx(db, storeName, mode, fn) {
    return new Promise((resolve, reject) => {
        let result;
        const transaction = db.transaction(storeName, mode);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror    = e => reject(e.target.error);
        transaction.onabort    = e => reject(e.target.error);

        const req = fn(transaction.objectStore(storeName));
        req.onsuccess = e => { result = e.target.result; };
        req.onerror   = e => reject(e.target.error);
    });
}