import { api } from '@/api/client'
import { getStoredSessionUserId, HttpError } from '@/api/http'

const databaseName = 'tsundoku-cover-upload-outbox'
const storeName = 'uploads'
const changedEventName = 'tsundoku:cover-upload-outbox-changed'
const databaseVersion = 1

export type PendingCoverUpload = {
  token: string
  ownerId: string
  bookId?: string
  file: Blob
  fileName: string
  contentType: string
  createdAt: number
}

export async function stagePendingCoverUpload(file: File) {
  const ownerId = getStoredSessionUserId()
  if (!ownerId) {
    throw new Error('Sign in before saving a cover upload.')
  }

  const token = crypto.randomUUID()
  await writeUpload({
    token,
    ownerId,
    file,
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    createdAt: Date.now(),
  })
  notifyCoverUploadOutbox()
  return token
}

export async function bindPendingCoverUpload(token: string, bookId: string) {
  const upload = await getUpload(token)
  if (!upload) {
    throw new Error('The pending cover upload is no longer available in this browser.')
  }

  await writeUpload({ ...upload, bookId })
  notifyCoverUploadOutbox()
}

export async function discardPendingCoverUpload(token: string) {
  await deleteUpload(token)
  notifyCoverUploadOutbox()
}

export function notifyCoverUploadOutbox() {
  window.dispatchEvent(new Event(changedEventName))
}

export function subscribeToCoverUploadOutbox(listener: () => void) {
  window.addEventListener(changedEventName, listener)
  return () => window.removeEventListener(changedEventName, listener)
}

export async function getPendingCoverUploads(ownerId: string) {
  const uploads = await readAllUploads()
  return uploads.filter((upload) => upload.ownerId === ownerId)
}

export async function processPendingCoverUpload(upload: PendingCoverUpload) {
  const bookId = upload.bookId ?? (await api.resolvePendingBookCoverUpload(upload.token)).bookId
  if (!upload.bookId) {
    await writeUpload({ ...upload, bookId })
  }

  const file = new File([upload.file], upload.fileName, { type: upload.contentType })
  await api.uploadBookCover(bookId, file)
  await deleteUpload(upload.token)
  notifyCoverUploadOutbox()
  return bookId
}

export function isPendingCoverUploadNotCreated(error: unknown) {
  return error instanceof HttpError && error.apiError.status === 404
}

function openDatabase() {
  if (!('indexedDB' in window)) {
    return Promise.reject(
      new Error('This browser cannot keep a cover upload ready in the background.'),
    )
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, databaseVersion)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: 'token' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open the local cover upload queue.'))
  })
}

async function writeUpload(upload: PendingCoverUpload) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put(upload)
    await complete(transaction)
  } finally {
    database.close()
  }
}

async function getUpload(token: string) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(storeName, 'readonly')
    const request: IDBRequest<unknown> = transaction.objectStore(storeName).get(token)
    const result = await requestResult(request)
    await complete(transaction)
    return isPendingCoverUpload(result) ? result : undefined
  } finally {
    database.close()
  }
}

async function readAllUploads() {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(storeName, 'readonly')
    const request: IDBRequest<unknown[]> = transaction.objectStore(storeName).getAll()
    const result = await requestResult(request)
    await complete(transaction)
    return result.filter(isPendingCoverUpload)
  } finally {
    database.close()
  }
}

async function deleteUpload(token: string) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).delete(token)
    await complete(transaction)
  } finally {
    database.close()
  }
}

function isPendingCoverUpload(value: unknown): value is PendingCoverUpload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'token' in value &&
    typeof value.token === 'string' &&
    'ownerId' in value &&
    typeof value.ownerId === 'string' &&
    'file' in value &&
    value.file instanceof Blob
  )
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('The local cover upload queue request failed.'))
  })
}

function complete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error('The local cover upload queue transaction was aborted.'),
      )
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('The local cover upload queue transaction failed.'))
  })
}
