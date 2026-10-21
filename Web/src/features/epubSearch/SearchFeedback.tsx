import { Button } from '@/components/ui/Button'
import { Pill } from '@/components/ui/ListParts'
import { retryLabel } from './crawlerMonitor'
import { isSearchFinished, type EpubSearchResult } from './types'

export function SearchFeedback({
  result,
  onRefresh,
}: {
  result: EpubSearchResult
  onRefresh: () => void
}) {
  const running = result.status !== undefined && !isSearchFinished(result.status)
  const warnings = [...new Set(result.warnings ?? [])]
  const count = result.candidates.reduce((sum, novel) => sum + novel.sources.length, 0)
  return (
    <div className="flex flex-col gap-3 rounded-field border border-line bg-sunk p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-semibold" role="status">
            {result.nextRetryAt
              ? 'Waiting for some sources to become available'
              : running
                ? 'Checking sources'
                : result.status === 'failed'
                  ? 'Search could not finish'
                  : warnings.length
                    ? 'Success with warnings'
                    : 'Source search finished'}
          </p>
          <p className="m-0 mt-1 text-[13px] text-ink-2">
            {result.candidates.length} {result.candidates.length === 1 ? 'novel' : 'novels'} found
            on {count} {count === 1 ? 'source' : 'sources'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          Refresh sources
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {result.skippedSourceCount ? (
          <Pill>{result.skippedSourceCount} sources skipped</Pill>
        ) : null}
        <Pill>
          {result.searchedSourceCount}
          {result.totalSourceCount ? `/${result.totalSourceCount}` : ''} sources checked
        </Pill>
        {result.totalLinkCount ? (
          <Pill>
            saved links {result.checkedLinkCount ?? 0}/{result.totalLinkCount}
          </Pill>
        ) : null}
        {result.nextRetryAt ? (
          <Pill>{retryLabel(result.nextRetryAt, result.retryAttempt)}</Pill>
        ) : null}
      </div>
      {running ? (
        <p className="m-0 text-[13px] text-ink-2">
          {result.nextRetryAt
            ? 'Results already found are ready to choose. Remaining sources will retry automatically.'
            : (result.currentSource ?? 'Waiting for a crawler worker.')}{' '}
          You can leave this window; the search continues in the background.
        </p>
      ) : null}
      {warnings.length || (result.nextRetryAt && result.currentSource) ? (
        <details className="text-[13px] text-ink-3">
          <summary className="cursor-pointer text-ink-2">
            {warnings.length
              ? `${warnings.length} source ${warnings.length === 1 ? 'issue' : 'issues'}`
              : 'Source cooldown'}{' '}
            · show details
          </summary>
          {result.nextRetryAt && result.currentSource ? (
            <p className="m-0 mt-2 break-words">{result.currentSource}</p>
          ) : null}
          <ul className="m-0 mt-2 flex flex-col gap-1 pl-5">
            {warnings.map((warning) => (
              <li key={warning} className="break-words">
                {warning}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
