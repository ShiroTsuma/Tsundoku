import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { analyticsTooltipProps, formatCount, seriesColor } from './chartUtils'

type Series = { key: string; label: string }

/**
 * Per-bucket values and the running total as two small charts on the same dates,
 * instead of one chart with two y-axes.
 */
export function SplitTrendChart({
  ariaLabel,
  cumulative,
  cumulativeDomain,
  data,
  perBucket,
}: {
  ariaLabel: string
  cumulative: Series
  cumulativeDomain: [number, number]
  data: readonly object[]
  perBucket: Series
}) {
  const tooltip = (label: string) => ({
    ...analyticsTooltipProps,
    formatter: (value: unknown) => [formatCount(Number(value)), label],
    labelFormatter: (date: unknown) => `Bucket ${String(date)}`,
  })

  return (
    <div aria-label={ariaLabel} className="grid gap-3" role="group">
      <figure className="m-0 min-w-0">
        <figcaption className="mb-1 text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase">
          {perBucket.label}
        </figcaption>
        <div className="h-36 min-w-0">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
              <CartesianGrid stroke="var(--color-line-soft)" vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis allowDecimals={false} tickLine={false} width={44} />
              <Tooltip {...tooltip(perBucket.label)} />
              <Bar
                dataKey={perBucket.key}
                fill={seriesColor}
                maxBarSize={32}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure className="m-0 min-w-0">
        <figcaption className="mb-1 text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase">
          {cumulative.label}
        </figcaption>
        <div className="h-40 min-w-0">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
              <CartesianGrid stroke="var(--color-line-soft)" vertical={false} />
              <XAxis dataKey="date" tickLine={false} minTickGap={24} />
              <YAxis allowDecimals={false} domain={cumulativeDomain} tickLine={false} width={44} />
              <Tooltip {...tooltip(cumulative.label)} />
              <Line
                dataKey={cumulative.key}
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--color-surface)', strokeWidth: 2 }}
                stroke={seriesColor}
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  )
}
