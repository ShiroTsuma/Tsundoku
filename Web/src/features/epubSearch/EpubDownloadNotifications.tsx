import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { getStoredSessionUserId } from '@/api/http'
import { useEpubSearchClient } from './clientContext'
import { observeDownloads, type DownloadNotificationState } from './downloadNotifications'
import { epubSearchKeys } from './queries'

export function EpubDownloadNotifications() {
  const ownerId = getStoredSessionUserId()
  return ownerId ? <OwnerDownloadNotifications key={ownerId} ownerId={ownerId} /> : null
}

function OwnerDownloadNotifications({ ownerId }: { ownerId: string }) {
  const client = useEpubSearchClient()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const storageKey = `tsundoku.epub-notifications.${ownerId}`
  const observed = useRef<DownloadNotificationState | null>(null)
  const jobs = useQuery({
    queryKey: epubSearchKeys.ownerDownloads(ownerId),
    queryFn: client.listOwnerDownloads ?? skipToken,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
    staleTime: 0,
    retry: false,
  })

  useEffect(() => {
    if (!jobs.data) return
    if (observed.current === null) {
      try {
        observed.current = JSON.parse(
          localStorage.getItem(storageKey) ?? '{}',
        ) as DownloadNotificationState
      } catch {
        observed.current = {}
      }
    }
    const { state, notices } = observeDownloads(jobs.data, observed.current)
    observed.current = state
    try {
      localStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      /* Memory still prevents repeats. */
    }
    for (const notice of notices) {
      const show = notice.error ? toast.error : toast.success
      show(notice.title, {
        id: notice.id,
        description: notice.description,
        action: {
          label: 'Open book',
          onClick: () => {
            void navigate(`/books/${notice.bookId}`)
          },
        },
        duration: 8000,
      })
      void queryClient.invalidateQueries({ queryKey: ['book-files', notice.bookId] })
      void queryClient.invalidateQueries({ queryKey: ['epub-jobs'] })
    }
  }, [jobs.data, navigate, queryClient, storageKey])

  return null
}
