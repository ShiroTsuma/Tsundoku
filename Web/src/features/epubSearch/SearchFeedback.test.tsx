import { screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { SearchFeedback } from './SearchFeedback'

it('presents partial source coverage as success with warnings while keeping results available', () => {
  renderWithProviders(
    <SearchFeedback
      onRefresh={vi.fn()}
      result={{
        status: 'completed',
        searchedSourceCount: 35,
        totalSourceCount: 35,
        durationMs: 1000,
        candidates: [{ id: 'novel', title: 'Holy Necromancer', match: 'title', sources: [] }],
        warnings: ['One source requires browser verification.'],
      }}
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent('Success with warnings')
  expect(screen.getByText('1 novel found on 0 sources')).toBeInTheDocument()
  expect(screen.getByText(/1 source issue/)).toBeInTheDocument()
})
