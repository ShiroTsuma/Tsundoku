import { API_BASE_URL, apiBlobRequest, getStoredSession, getStoredSessionUserId } from '@/api/http'

const COVER_CACHE_PREFIX = 'tsundoku.covers.v1::'

export async function loadCoverBlobUrl(imageUrl: string) {
  const absoluteUrl = toAbsoluteUrl(imageUrl)
  if (!absoluteUrl) {
    return null
  }

  const cache = await openCoverCache()
  const request = new Request(absoluteUrl, { method: 'GET' })

  if (cache) {
    const cached = await cache.match(request)
    if (cached) {
      return URL.createObjectURL(await cached.blob())
    }
  }

  const blob = await fetchCoverBlob(absoluteUrl)
  if (!blob) {
    return null
  }

  if (cache) {
    await pruneOlderVariants(cache, absoluteUrl)
    await cache.put(request, new Response(blob))
  }

  return URL.createObjectURL(blob)
}

async function openCoverCache() {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return null
  }

  return window.caches.open(getCoverCacheName())
}

function getCoverCacheName() {
  return `${COVER_CACHE_PREFIX}${getStoredSessionUserId() ?? 'anonymous'}`
}

function toAbsoluteUrl(imageUrl: string) {
  if (!imageUrl) {
    return null
  }

  try {
    if (/^https?:\/\//i.test(imageUrl)) {
      return new URL(imageUrl).toString()
    }

    const apiBase = getApiBaseUrl()
    if (!apiBase) {
      return null
    }

    return new URL(imageUrl, apiBase).toString()
  } catch {
    return null
  }
}

async function pruneOlderVariants(cache: Cache, nextAbsoluteUrl: string) {
  const nextUrl = parseUrl(nextAbsoluteUrl)
  if (!nextUrl) {
    return
  }

  const keys = await cache.keys()

  await Promise.all(
    keys.map(async (request) => {
      const currentUrl = parseUrl(request.url)
      if (!currentUrl) {
        return
      }

      if (currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search) {
        await cache.delete(request)
      }
    }),
  )
}

async function fetchCoverBlob(absoluteUrl: string) {
  const apiPath = toApiPath(absoluteUrl)
  if (apiPath) {
    try {
      return await apiBlobRequest(apiPath)
    } catch {
      return null
    }
  }

  const token = getStoredSession()?.accessToken

  try {
    const response = await fetch(
      absoluteUrl,
      token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    )
    if (!response.ok) {
      return null
    }

    return await response.blob()
  } catch {
    return null
  }
}

function parseUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

function toApiPath(absoluteUrl: string) {
  const parsed = parseUrl(absoluteUrl)
  if (!parsed) {
    return null
  }

  const apiBase = getApiBaseUrl()
  if (!apiBase) {
    return null
  }

  const apiPrefix = apiBase.pathname.replace(/\/$/, '')
  if (parsed.origin !== apiBase.origin || !parsed.pathname.startsWith(apiPrefix)) {
    return null
  }

  const path = parsed.pathname.slice(apiPrefix.length) || '/'
  return `${path}${parsed.search}`
}

function getApiBaseUrl() {
  try {
    return new URL(API_BASE_URL, window.location.origin)
  } catch {
    return null
  }
}
