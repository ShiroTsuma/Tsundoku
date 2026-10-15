import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createTestQueryClient } from '@/test/render'
import { nsfwPreferenceStorageKey } from '@/lib/nsfwPreference'
import { AppShell } from './AppShell'

const authState = vi.hoisted(() => ({ isAdmin: false }))

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    isAdmin: authState.isAdmin,
    logout: vi.fn(),
    token: null,
  }),
}))

function primaryNav() {
  return screen.getByRole('navigation', { name: 'Primary navigation' })
}

function mobileNav() {
  return screen.getByRole('navigation', { name: 'Primary navigation (mobile)' })
}

describe('AppShell', () => {
  it('exposes stable shell landmarks', () => {
    renderAt('/books')

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(primaryNav()).toBeInTheDocument()
    expect(mobileNav()).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
    expect(screen.getByRole('link', { name: 'Tsundoku' })).toHaveAttribute('href', '/books')
    expect(screen.getByRole('link', { name: /skip to content/i })).toHaveAttribute(
      'href',
      '#main-content',
    )
    expect(screen.getByRole('button', { name: /enable nsfw content/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('link', { name: 'Add book' })).toHaveAttribute('href', '/books/new')
    expect(screen.getByRole('button', { name: 'Jump to book or page' })).toBeInTheDocument()
  })

  it('logs out from the account menu', async () => {
    const user = userEvent.setup()
    renderAt('/books')
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument()
  })

  it('opens the jump palette with Ctrl+K and lists pages', async () => {
    const user = userEvent.setup()
    renderAt('/books')
    await user.keyboard('{Control>}k{/Control}')
    const dialog = screen.getByRole('dialog', { name: 'Jump to book or page' })
    expect(dialog).toBeInTheDocument()
    await user.type(screen.getByRole('combobox', { name: 'Jump to book or page' }), 'sta')
    expect(screen.getByRole('option', { name: /Stats/ })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Jump to book or page' })).not.toBeInTheDocument()
  })

  it('lists the four destinations in both navigations', () => {
    renderAt('/books')

    for (const nav of [primaryNav(), mobileNav()]) {
      const names = within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent)
      expect(names).toEqual(['Library', 'Discover', 'Stats', 'Manage'])
    }
  })

  it('adds Admin to the desktop navigation for admins', () => {
    authState.isAdmin = true
    renderAt('/books')
    authState.isAdmin = false

    expect(within(primaryNav()).getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'href',
      '/admin',
    )
  })

  it('stores the NSFW preference and refreshes cached requests', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderAt('/books')
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: /enable nsfw content/i }))

    expect(window.localStorage.getItem(nsfwPreferenceStorageKey)).toBe('true')
    expect(screen.getByRole('button', { name: /disable nsfw content/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(invalidateQueries).toHaveBeenCalled()
  })

  it('keeps Library inactive on the add-book route', () => {
    renderAt('/books/new')

    expect(within(primaryNav()).getByRole('link', { name: 'Library' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('marks only Library as active on the books list route', () => {
    renderAt('/books')

    const nav = within(primaryNav())
    expect(nav.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: 'Stats' })).not.toHaveAttribute('aria-current')
  })

  it('marks Stats as active on the analytics route', () => {
    renderAt('/analytics')

    const nav = within(primaryNav())
    expect(nav.getByRole('link', { name: 'Stats' })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: 'Library' })).not.toHaveAttribute('aria-current')
  })

  it('marks Manage as active in the mobile navigation', () => {
    renderAt('/manage')

    expect(within(mobileNav()).getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

function renderAt(route: string) {
  const queryClient = createTestQueryClient()
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route element={<div>Page</div>} path="/books" />
              <Route element={<div>Page</div>} path="/analytics" />
              <Route element={<div>Page</div>} path="/books/new" />
              <Route element={<div>Page</div>} path="/manage" />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}
