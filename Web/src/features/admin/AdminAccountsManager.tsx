import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { getStoredSessionUserId, HttpError } from '@/api/http'
import type { AdminUserDto } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { listRowClass, ListBox, Pill, SearchField, StateBox } from '@/components/ui/ListParts'
import { firstFilled } from './adminText'

export function AdminAccountsManager() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selected, setSelected] = useState<AdminUserDto | null>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [search])
  const users = useQuery({
    queryKey: ['admin-users', debouncedSearch],
    queryFn: () => api.getAdminUsers({ skip: 0, take: 100, search: debouncedSearch }),
  })
  const total = users.data?.total ?? 0

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          label="Search user accounts"
          placeholder="Search by username or email…"
          value={search}
          onChange={setSearch}
        />
        <span className="text-[13px] text-ink-3 tabular-nums" role="status">
          {users.isFetching
            ? 'Searching…'
            : `${total.toLocaleString()} ${total === 1 ? 'account' : 'accounts'}`}
        </span>
      </div>
      <p className="m-0 text-[13px] text-ink-3">
        Deleting an account also deletes its books, private tags, sessions, and unused authors.
      </p>

      {users.isPending ? (
        <StateBox>Loading accounts…</StateBox>
      ) : users.isError ? (
        <StateBox tone="error">Could not load accounts.</StateBox>
      ) : users.data.data.length === 0 ? (
        <StateBox>No accounts found.</StateBox>
      ) : (
        <ListBox label="User accounts">
          {users.data.data.map((user) => {
            const isCurrent = user.id === getStoredSessionUserId()
            const name = firstFilled(user.username, user.email) ?? user.id
            return (
              <div className={listRowClass} key={user.id} role="group">
                <div className="min-w-0 flex-[1_1_16rem]">
                  <div className="truncate font-semibold">
                    {firstFilled(user.username) ?? 'Unnamed user'}
                  </div>
                  <div className="truncate text-[13px] text-ink-3">
                    {firstFilled(user.email) ?? user.id}
                  </div>
                </div>
                <Pill>
                  {user.booksCount.toLocaleString()} {user.booksCount === 1 ? 'book' : 'books'}
                </Pill>
                <Pill>
                  {user.tagsCount.toLocaleString()} {user.tagsCount === 1 ? 'tag' : 'tags'}
                </Pill>
                {isCurrent ? (
                  <Pill tone="good">You</Pill>
                ) : (
                  <Button
                    aria-label={`Delete account ${name}`}
                    size="row"
                    variant="danger"
                    onClick={() => setSelected(user)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            )
          })}
        </ListBox>
      )}
      {selected ? <DeleteAccountDialog user={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  )
}

function DeleteAccountDialog({ user, onClose }: { user: AdminUserDto; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)

  async function remove() {
    setDeleting(true)
    try {
      const result = await api.deleteAdminUser(user.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
        queryClient.invalidateQueries({ queryKey: ['adminBooks'] }),
      ])
      toast.success(
        `Account deleted with ${result.deletedBooks} books, ${result.deletedTags} tags, and ${result.deletedAuthors} authors.`,
      )
      onClose()
    } catch (error) {
      toast.error(
        error instanceof HttpError
          ? error.apiError.detail
          : error instanceof Error
            ? error.message
            : 'Account could not be deleted.',
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog
      open
      dismissible={!deleting}
      footer={
        <>
          <span className="flex-1" />
          <Button disabled={deleting} variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={deleting} variant="danger" onClick={() => void remove()}>
            <Trash2 aria-hidden="true" className="size-4" />
            {deleting ? 'Deleting…' : 'Delete account permanently'}
          </Button>
        </>
      }
      title={`Delete ${firstFilled(user.username, user.email) ?? 'account'}?`}
      widthClassName="max-w-[520px]"
      onClose={onClose}
    >
      <p className="m-0 px-6 pt-4 pb-6 text-ink-2">
        This permanently removes the account, {user.booksCount} books, {user.tagsCount} private
        tags, sign-in sessions, and authors no longer used elsewhere. It cannot be undone.
      </p>
    </Dialog>
  )
}
