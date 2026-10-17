import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { apiRequest } from '@/api/http'
import { Button } from '@/components/ui/Button'

type ProcessingState = { processingEnabled: boolean }
const key = ['crawler-processing']

export function CrawlerProcessingControl() {
  const cache = useQueryClient()
  const query = useQuery({
    queryKey: key,
    queryFn: () => apiRequest<ProcessingState>('/admin/crawler/processing'),
    refetchInterval: 5000,
    retry: false,
  })
  const update = useMutation({
    mutationFn: (processingEnabled: boolean) =>
      apiRequest<ProcessingState>('/admin/crawler/processing', {
        method: 'PUT',
        body: { processingEnabled },
      }),
    onSuccess: (state) => {
      cache.setQueryData(key, state)
      void cache.invalidateQueries({ queryKey: ['crawler-monitor'] })
      void cache.invalidateQueries({ queryKey: ['crawler-source-health'] })
      toast.success(
        state.processingEnabled ? 'Crawler processing started.' : 'Crawler processing paused.',
      )
    },
    onError: () => toast.error('Could not change crawler processing. Try again.'),
  })
  const running = query.data?.processingEnabled === true
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-line bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="m-0 text-sm font-semibold" role="status">
          {query.isPending
            ? 'Connecting to crawler…'
            : query.isError
              ? 'Crawler unavailable'
              : running
                ? 'Processing active'
                : 'Processing paused'}
        </p>
        <p className="m-0 mt-1 text-xs text-ink-3">
          {running
            ? 'The crawler is processing the queue.'
            : 'Queued jobs and saved results are preserved.'}
        </p>
      </div>
      <Button
        variant={running ? 'outline' : 'primary'}
        disabled={!query.data || query.isError || update.isPending}
        onClick={() => update.mutate(!running)}
      >
        {running ? (
          <Pause aria-hidden="true" className="size-4" />
        ) : (
          <Play aria-hidden="true" className="size-4" />
        )}
        {update.isPending ? 'Saving…' : running ? 'Pause processing' : 'Start processing'}
      </Button>
    </div>
  )
}
