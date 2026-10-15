import type { ReactNode } from 'react'
import { ColumnHeader } from './bookListColumns'
import type { ColumnDefinition } from './columnPreferences'

const minimumTableWidthRem = 76
const fallbackColumnWidthRem = 9
const defaultActionsColumnWidthRem = 8

export function BookDataTable<T extends { id: string }>({
  actionHeader = 'Actions',
  actionsWidthRem = defaultActionsColumnWidthRem,
  columns,
  emptyMessage,
  isCyclicSort = () => false,
  isLoading,
  items,
  loadingMessage = 'Loading...',
  renderActions,
  sortBy,
  sortDirection,
  wrapperClassName = 'w-full',
  onSort,
}: {
  actionHeader?: string
  /** Width of the sticky actions column, in rem. */
  actionsWidthRem?: number
  columns: ColumnDefinition<T>[]
  emptyMessage: string
  isCyclicSort?: (sortBy: string) => boolean
  isLoading: boolean
  items: T[]
  loadingMessage?: string
  renderActions: (item: T) => ReactNode
  sortBy: string | null
  sortDirection: string | null
  wrapperClassName?: string
  onSort: (sortBy: string) => void
}) {
  const tableMinWidthRem = getBookTableMinWidthRem(columns, actionsWidthRem)

  return (
    <div
      className={`book-table-scroll ${wrapperClassName} max-w-full overflow-x-auto`}
      // Focused cells scroll clear of the sticky actions column.
      style={{ scrollPaddingInlineEnd: `${String(actionsWidthRem)}rem` }}
    >
      <table
        className="w-full table-fixed border-collapse text-left text-sm [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4"
        style={{ minWidth: `${tableMinWidthRem}rem` }}
      >
        <colgroup>
          {columns.map((column) => (
            <col className={column.grow ? '' : (column.widthClass ?? '')} key={column.id} />
          ))}
          <col style={{ width: `${actionsWidthRem}rem` }} />
        </colgroup>
        <thead className="text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase">
          <tr>
            {columns.map((column) => (
              <ColumnHeader
                activeDirection={column.sortBy === sortBy ? sortDirection : null}
                column={column}
                isCyclic={column.sortBy ? isCyclicSort(column.sortBy) : false}
                key={column.id}
                onSort={onSort}
              />
            ))}
            <th className="sticky right-0 z-10 shadow-[-12px_0_12px_-12px_rgb(0_0_0/0.7)] border-b border-line bg-sunk px-3 py-3 text-right">
              <span className="sr-only">{actionHeader}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td className="px-4 py-8 text-center text-ink-3" colSpan={columns.length + 1}>
                {loadingMessage}
              </td>
            </tr>
          ) : null}
          {items.map((item) => (
            <tr
              className="book-table-row group border-b border-line-soft last:border-b-0 hover:bg-hover"
              data-testid={`book-table-row-${item.id}`}
              key={item.id}
            >
              {columns.map((column) => {
                const content = column.render(item)
                const title =
                  typeof content === 'string' || typeof content === 'number'
                    ? String(content)
                    : undefined

                return (
                  <td
                    className="book-table-cell px-3 py-2.5 align-middle text-ink-2"
                    data-testid={`book-table-cell-${item.id}-${column.id}`}
                    key={column.id}
                  >
                    <div className="overflow-hidden" title={title}>
                      {content}
                    </div>
                  </td>
                )
              })}
              <td
                className="book-table-actions-cell sticky right-0 z-10 shadow-[-12px_0_12px_-12px_rgb(0_0_0/0.7)] bg-sunk px-3 py-2.5 group-hover:bg-hover"
                data-testid={`book-table-actions-cell-${item.id}`}
              >
                <div className="flex justify-end gap-1.5 whitespace-nowrap">
                  {renderActions(item)}
                </div>
              </td>
            </tr>
          ))}
          {!isLoading && items.length === 0 ? (
            <tr>
              <td className="px-4 py-8 text-center text-ink-3" colSpan={columns.length + 1}>
                {emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function getBookTableMinWidthRem(columns: { widthClass?: string }[], actionsWidthRem: number) {
  const columnWidth = columns.reduce(
    (sum, column) => sum + getTailwindWidthRem(column.widthClass),
    actionsWidthRem,
  )
  return Math.max(minimumTableWidthRem, columnWidth)
}

function getTailwindWidthRem(widthClass?: string) {
  if (!widthClass) {
    return fallbackColumnWidthRem
  }

  const spacingMatch = /^w-(\d+)$/.exec(widthClass)
  if (spacingMatch) {
    return Number(spacingMatch[1]) / 4
  }

  const remMatch = /^w-\[(\d+(?:\.\d+)?)rem\]$/.exec(widthClass)
  if (remMatch) {
    return Number(remMatch[1])
  }

  return fallbackColumnWidthRem
}
