import { useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  Compass,
  Eye,
  EyeOff,
  LibraryBig,
  Plus,
  Search,
  Settings2,
  Shield,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { CommandPalette } from '@/components/app/CommandPalette'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Menu } from '@/components/ui/Menu'
import { getTokenDisplayName } from '@/features/auth/tokenIdentity'
import { useAuth } from '@/features/auth/useAuth'
import { isNsfwEnabled, setNsfwEnabled } from '@/lib/nsfwPreference'
import { cn } from '@/lib/utils'

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  /** Match the path exactly, so /books does not stay active on /books/new. */
  end?: boolean
}

const navItems: NavItem[] = [
  { to: '/books', label: 'Library', icon: LibraryBig, end: true },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/analytics', label: 'Stats', icon: BarChart3 },
  { to: '/manage', label: 'Manage', icon: Settings2 },
]

const adminItem: NavItem = { to: '/admin', label: 'Admin', icon: Shield }

export function AppShell() {
  const { isAdmin, logout, token } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [nsfwEnabled, setNsfwEnabledState] = useState(isNsfwEnabled)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const items = isAdmin ? [...navItems, adminItem] : navItems
  const displayName = getTokenDisplayName(token ?? null)
  const initial = (displayName ?? '?').charAt(0).toUpperCase()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  async function handleLogout() {
    await logout()
    void navigate('/login', { replace: true })
  }

  function handleNsfwToggle() {
    setNsfwEnabledState(setNsfwEnabled(!nsfwEnabled))
    void queryClient.invalidateQueries()
  }

  return (
    <div className="min-h-screen pb-[76px] text-ink md:pb-0">
      <a
        className="sr-only z-50 rounded-control bg-accent px-4 py-2 font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        href="#main-content"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-ground/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 w-full max-w-(--page-max-width) items-center gap-x-7 gap-y-3 px-4 md:px-8">
          <Link
            to="/books"
            className="flex items-center gap-2.5 font-display text-xl font-bold text-ink hover:text-ink"
          >
            <span className="flex size-8 items-center justify-center rounded-control bg-accent text-accent-ink">
              <LibraryBig aria-hidden="true" className="size-[18px]" />
            </span>
            Tsundoku
          </Link>
          <nav aria-label="Primary navigation" className="hidden gap-1 md:flex">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end ?? false}
                className={({ isActive }) =>
                  cn(
                    'rounded-control px-3.5 py-2.5 transition-colors',
                    isActive
                      ? 'bg-raised font-semibold text-ink'
                      : 'font-medium text-ink-2 hover:text-ink',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Jump to book or page"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => setPaletteOpen(true)}
              className="flex h-10 items-center gap-2.5 rounded-control border border-line bg-surface px-3 text-left text-ink-3 hover:border-line-strong xl:min-w-[240px]"
            >
              <Search aria-hidden="true" className="size-4" />
              <span className="hidden flex-1 xl:inline">Jump to book or page…</span>
              <kbd className="hidden rounded border border-line-strong px-1.5 py-0.5 font-sans text-xs text-ink-2 xl:inline">
                Ctrl K
              </kbd>
            </button>
            <button
              type="button"
              aria-label={nsfwEnabled ? 'Disable NSFW content' : 'Enable NSFW content'}
              aria-pressed={nsfwEnabled}
              onClick={handleNsfwToggle}
              className={cn(
                'flex h-10 items-center gap-2 rounded-control border border-line bg-transparent px-3 text-ink-2 hover:border-line-strong hover:text-ink',
                nsfwEnabled && 'border-status-hold text-status-hold-ink',
              )}
            >
              {nsfwEnabled ? (
                <Eye aria-hidden="true" className="size-4" />
              ) : (
                <EyeOff aria-hidden="true" className="size-4" />
              )}
              <span className="hidden lg:inline">{nsfwEnabled ? 'NSFW shown' : 'NSFW hidden'}</span>
            </button>
            <Link
              to="/books/new"
              aria-label="Add book"
              className={cn(buttonStyles({ variant: 'primary' }), 'px-3 sm:px-4')}
            >
              <Plus aria-hidden="true" className="size-4" strokeWidth={2.4} />
              <span className="hidden sm:inline">Add book</span>
            </Link>
            <Menu
              label="Account menu"
              triggerClassName="flex size-10 items-center justify-center rounded-full border border-line-strong bg-raised font-semibold text-ink hover:bg-selected"
              triggerContent={initial}
              widthClassName="w-56"
              sections={[
                {
                  title: displayName ?? 'Signed in',
                  items: [{ label: 'Log out', onSelect: () => void handleLogout() }],
                },
              ]}
            />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-(--page-max-width) px-4 pt-6 pb-[calc(76px+2rem)] md:px-8 md:pb-14"
      >
        <Outlet />
      </main>

      <nav
        aria-label="Primary navigation (mobile)"
        className="fixed inset-x-0 bottom-0 z-40 grid h-[76px] grid-cols-4 border-t border-line bg-sunk/95 pb-3 backdrop-blur-md md:hidden"
      >
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end ?? false}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-1 text-xs',
                isActive ? 'font-semibold text-ink' : 'text-ink-2',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn('flex rounded-full px-4 py-1', isActive && 'bg-selected')}
                  aria-hidden="true"
                >
                  <item.icon className="size-5" />
                </span>
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <CommandPalette open={paletteOpen} isAdmin={isAdmin} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
