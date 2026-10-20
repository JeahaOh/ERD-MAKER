const DB_NAME = 'erd-maker-local';
export interface RecoveryInfo { id: string; filename: string; savedAt: number; size: number }
export interface RecoverySnapshot extends RecoveryInfo { bytes: Uint8Array }
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains('recovery') ? request.transaction!.objectStore('recovery') : request.result.createObjectStore('recovery');
      if (!store.indexNames.contains('savedAt')) store.createIndex('savedAt', 'savedAt');
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('다른 창에서 이전 버전의 복구 저장소를 사용하고 있습니다.')); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
  });
}
export async function writeRecovery(bytes: Uint8Array, filename: string, id: string): Promise<void> {
  if (!id || !bytes.byteLength) throw new Error('복구본 ID와 모델 데이터가 필요합니다.');
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('recovery', 'readwrite');
      tx.objectStore('recovery').put({ bytes, filename, savedAt: Date.now(), size: bytes.byteLength }, id);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('복구 저장이 중단됐습니다.'));
    });
  } finally { db.close(); }
}
export async function listRecoveries(): Promise<RecoveryInfo[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('recovery', 'readonly'), request = tx.objectStore('recovery').index('savedAt').openCursor(null, 'prev');
      const result: RecoveryInfo[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const value = cursor.value;
        if (value?.bytes instanceof Uint8Array && typeof value.filename === 'string' && Number.isFinite(value.savedAt)) result.push({ id: String(cursor.primaryKey), filename: value.filename, savedAt: value.savedAt, size: value.bytes.byteLength });
        cursor.continue();
      };
      tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('복구 목록 조회가 중단됐습니다.'));
    });
  } finally { db.close(); }
}
export async function readRecovery(id: string): Promise<RecoverySnapshot | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('recovery', 'readonly'), req = tx.objectStore('recovery').get(id);
      let snapshot: RecoverySnapshot | undefined;
      req.onsuccess = () => {
        const value = req.result;
        if (value) {
          if (!(value.bytes instanceof Uint8Array) || typeof value.filename !== 'string' || !Number.isFinite(value.savedAt)) { reject(new Error('복구본 형식이 올바르지 않습니다.')); return; }
          snapshot = { ...value, id, size: value.bytes.byteLength };
        }
      };
      tx.oncomplete = () => resolve(snapshot); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('복구본 조회가 중단됐습니다.'));
    });
  } finally { db.close(); }
}
export async function deleteRecovery(id: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('recovery', 'readwrite'); tx.objectStore('recovery').delete(id);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('복구본 삭제가 중단됐습니다.'));
    });
  } finally { db.close(); }
}
