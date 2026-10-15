import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { QueryBar, QuickFilters, StatusTabs, TypeChips } from './BookListControls'

describe('StatusTabs', () => {
  it('marks the tab that matches the status token', () => {
    render(<StatusTabs query='status:"plan to read" dragon' onQueryChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Plan to read' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('rewrites only the status token of the query', async () => {
    const onQueryChange = vi.fn()
    render(<StatusTabs query="status:reading genre:fantasy" onQueryChange={onQueryChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Completed' }))
    expect(onQueryChange).toHaveBeenLastCalledWith('status:completed genre:fantasy')
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(onQueryChange).toHaveBeenLastCalledWith('genre:fantasy')
  })
})

describe('QuickFilters', () => {
  it('toggles a token and shows its syntax', async () => {
    const onQueryChange = vi.fn()
    const { rerender } = render(<QuickFilters query="dragon" onQueryChange={onQueryChange} />)
    const rated = screen.getByRole('button', { name: /Rated 8\+/ })
    expect(rated).toHaveTextContent('rating:>=8')
    expect(rated).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(rated)
    expect(onQueryChange).toHaveBeenLastCalledWith('dragon rating:>=8')

    rerender(<QuickFilters query="dragon rating:>=8" onQueryChange={onQueryChange} />)
    expect(screen.getByRole('button', { name: /Rated 8\+/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(screen.getByRole('button', { name: /Rated 8\+/ }))
    expect(onQueryChange).toHaveBeenLastCalledWith('dragon')
  })
})

describe('QueryBar', () => {
  it('shows tokens as pills and removes exactly one token', async () => {
    const onQueryChange = vi.fn()
    renderWithProviders(<QueryBar query="genre:fantasy -tag:harem" onQueryChange={onQueryChange} />)
    const pills = screen.getByRole('list', { name: 'Active filters' })
    expect(within(pills).getAllByRole('listitem')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter -tag:harem' }))
    expect(onQueryChange).toHaveBeenLastCalledWith('genre:fantasy')
  })

  it('switches to the raw query editor', async () => {
    renderWithProviders(<QueryBar query="genre:fantasy" onQueryChange={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Query' }))
    expect(screen.getByRole('combobox', { name: /search books/i })).toHaveValue('genre:fantasy')
    expect(screen.getByRole('combobox', { name: /search books/i })).toHaveFocus()
  })

  it('negates a token when its pill is clicked', async () => {
    const onQueryChange = vi.fn()
    renderWithProviders(<QueryBar query="genre:fantasy -tag:harem" onQueryChange={onQueryChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Exclude genre:fantasy' }))
    expect(onQueryChange).toHaveBeenLastCalledWith('-genre:fantasy -tag:harem')
    await userEvent.click(screen.getByRole('button', { name: 'Include -tag:harem' }))
    expect(onQueryChange).toHaveBeenLastCalledWith('genre:fantasy tag:harem')
  })

  it('goes back to pills when focus leaves the editor', async () => {
    renderWithProviders(
      <>
        <QueryBar query="genre:fantasy" onQueryChange={vi.fn()} />
        <button type="button">Elsewhere</button>
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Query' }))
    expect(screen.getByRole('combobox', { name: /search books/i })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.getByRole('list', { name: 'Active filters' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /search books/i })).not.toBeInTheDocument()
  })

  it('keeps the editor while typing into an empty query', async () => {
    function Harness() {
      const [query, setQuery] = useState('')
      return <QueryBar query={query} onQueryChange={setQuery} />
    }
    renderWithProviders(<Harness />)
    await userEvent.type(screen.getByRole('combobox', { name: /search books/i }), 'dragon')
    expect(screen.getByRole('combobox', { name: /search books/i })).toHaveValue('dragon')
  })

  it('starts in the editor when the query is empty', () => {
    renderWithProviders(<QueryBar query="" onQueryChange={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: /search books/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filters' })).toBeDisabled()
  })
})

describe('saved views', () => {
  it('saves the current query, applies it and deletes it', async () => {
    window.localStorage.removeItem('tsundoku.books.saved-views.v1')
    const onQueryChange = vi.fn()
    const { rerender } = render(
      <QuickFilters query="genre:fantasy rating:>=8" onQueryChange={onQueryChange} />,
    )
    await userEvent.click(screen.getByRole('button', { name: '+ Save current as view' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Saved view name' }), 'Good fantasy')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    rerender(<QuickFilters query="" onQueryChange={onQueryChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Good fantasy' }))
    expect(onQueryChange).toHaveBeenLastCalledWith('genre:fantasy rating:>=8')
    expect(window.localStorage.getItem('tsundoku.books.saved-views.v1')).toContain('Good fantasy')

    await userEvent.click(screen.getByRole('button', { name: 'Delete saved view Good fantasy' }))
    expect(screen.queryByRole('button', { name: 'Good fantasy' })).not.toBeInTheDocument()
  })
})

describe('TypeChips', () => {
  it('writes the type token and shows counts from the rest of the query', async () => {
    const onQueryChange = vi.fn()
    render(
      <TypeChips
        counts={{ all: 12, novel: 9, manga: 3 }}
        query="status:reading"
        types={['Novel', 'Manga', 'Manhwa']}
        onQueryChange={onQueryChange}
      />,
    )
    expect(screen.getByRole('button', { name: /All typess*12/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /Manhwas*0/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Novels*9/ }))
    expect(onQueryChange).toHaveBeenLastCalledWith('type:novel status:reading')
  })
})
