import { Activity } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Menu, type MenuSection } from '@/components/ui/Menu'
import { useAuth } from '@/features/auth/useAuth'
import { useCrawlerMonitor, jobProgress, jobKindLabels } from './crawlerMonitor'

export function CrawlerActivity() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const query = useCrawlerMonitor()
  const data = query.data
  const active = data && (data.runningJobs + data.waitingJobs > 0 || data.pendingBooks > 0)
  const summary = !data
    ? query.isError
      ? 'Status unavailable'
      : 'Loading status'
    : !data.enabled
      ? 'Crawler disabled'
      : `${data.checkedBooks}/${data.totalBooks} books checked`
  const sections: MenuSection[] = [
    {
      title: 'Crawler activity',
      items: [
        {
          label: summary,
          description: data
            ? `${data.runningJobs} running · ${data.waitingJobs} waiting · ${data.pendingBooks} books in metadata queue`
            : 'Status will refresh automatically.',
          disabled: true,
          onSelect: () => undefined,
        },
      ],
    },
    {
      title: 'Current tasks',
      items: data?.jobs.length
        ? data.jobs.slice(0, 5).map((job) => ({
            label: job.bookTitle,
            description: `${jobKindLabels[job.kind] ?? job.kind} · ${jobProgress(job)}`,
            onSelect: () => {
              void navigate(`/books/${job.bookId}`)
            },
          }))
        : [{ label: 'No active tasks', disabled: true, onSelect: () => undefined }],
    },
  ]
  if (isAdmin)
    sections.push({
      items: [
        {
          label: 'Open crawler admin panel',
          onSelect: () => {
            void navigate('/admin?tab=crawler')
          },
        },
      ],
    })
  if (!data?.enabled || data.processingEnabled === false || !active) return null
  return (
    <Menu
      label={`Crawler activity: ${summary}`}
      widthClassName="w-80 max-w-[calc(100vw-2rem)]"
      triggerClassName="flex h-10 shrink-0 items-center gap-2 rounded-control border border-line bg-transparent px-2 text-ink-2 hover:border-line-strong hover:text-ink lg:px-3"
      triggerContent={
        <>
          <Activity aria-hidden="true" className="size-4 text-accent" />
          <span className="hidden text-[13px] tabular-nums lg:inline">
            Crawler {data.checkedBooks}/{data.totalBooks}
          </span>
        </>
      }
      sections={sections}
    />
  )
}
