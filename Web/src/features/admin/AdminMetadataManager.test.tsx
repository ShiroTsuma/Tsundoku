import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { apiRequest } from '@/api/http'
import type * as HttpModule from '@/api/http'
import { renderWithProviders } from '@/test/render'
import { AdminMetadataManager } from './AdminMetadataManager'

vi.mock('@/api/client', () => ({
  api: {
    getStatuses: vi.fn(),
    getTypes: vi.fn(),
    getGenres: vi.fn(),
    searchAdminGlobalTags: vi.fn(),
    searchTags: vi.fn(),
    createAdminStatus: vi.fn(),
    createAdminType: vi.fn(),
    createAdminGenre: vi.fn(),
    createAdminGlobalTag: vi.fn(),
    updateAdminStatus: vi.fn(),
    updateAdminType: vi.fn(),
    updateAdminGenre: vi.fn(),
    updateAdminGlobalTag: vi.fn(),
    deleteAdminStatus: vi.fn(),
    deleteAdminType: vi.fn(),
    deleteAdminGenre: vi.fn(),
    deleteAdminGlobalTag: vi.fn(),
  },
}))

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof HttpModule>()),
  apiRequest: vi.fn().mockResolvedValue([]),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const status = { id: 'status-1', name: 'Reading', description: 'Currently reading' }
const globalTag = {
  id: 'tag-1',
  name: 'official',
  description: 'Shared with everyone',
  color: null,
  isGlobal: true,
}

describe('AdminMetadataManager', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset().mockResolvedValue([])
    vi.mocked(api.searchTags).mockReset().mockResolvedValue([])
    vi.mocked(api.getStatuses)
      .mockReset()
      .mockResolvedValue({ skip: 0, take: 100, total: 1, data: [status] })
    vi.mocked(api.getTypes)
      .mockReset()
      .mockResolvedValue({ skip: 0, take: 100, total: 0, data: [] })
    vi.mocked(api.getGenres)
      .mockReset()
      .mockResolvedValue({ skip: 0, take: 100, total: 0, data: [] })
    vi.mocked(api.searchAdminGlobalTags).mockReset().mockResolvedValue([globalTag])
    vi.mocked(api.createAdminStatus).mockReset().mockResolvedValue(status)
    vi.mocked(api.createAdminGlobalTag).mockReset().mockResolvedValue(globalTag)
    vi.mocked(api.updateAdminGlobalTag).mockReset().mockResolvedValue(globalTag)
    vi.mocked(api.deleteAdminGlobalTag).mockReset().mockResolvedValue(undefined)
  })

  it('creates a status using the manage-style dialog', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminMetadataManager />)

    await user.click(await screen.findByRole('button', { name: 'Add status' }))
    await user.type(screen.getByLabelText('Name'), 'Paused')
    await user.type(screen.getByLabelText('Description'), 'Temporarily paused')
    await user.click(screen.getByRole('button', { name: 'Create status' }))

    await waitFor(() =>
      expect(api.createAdminStatus).toHaveBeenCalledWith({
        name: 'Paused',
        description: 'Temporarily paused',
      }),
    )
  })

  it('edits and deletes a global tag', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminMetadataManager />)
    await user.click(screen.getByRole('button', { name: 'Global tags' }))

    fireEvent.doubleClick(await screen.findByText('official'))
    await user.clear(screen.getByLabelText('Description'))
    await user.type(screen.getByLabelText('Description'), 'Updated globally')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(api.updateAdminGlobalTag).toHaveBeenCalledWith('tag-1', {
        name: 'official',
        description: 'Updated globally',
      }),
    )

    await user.click(await screen.findByRole('button', { name: 'Edit global tag official' }))
    await user.click(screen.getByRole('button', { name: 'Delete global tag' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(api.deleteAdminGlobalTag).toHaveBeenCalledWith('tag-1'))
  })
  it('opens Rules as a dictionary section and uses segmented Tag/Genre controls', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AdminMetadataManager />)
    const dictionaries = screen.getByRole('group', { name: 'Dictionary' })
    await user.click(within(dictionaries).getByRole('button', { name: 'Rules' }))
    expect(within(dictionaries).getByRole('button', { name: 'Rules' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByRole('button', { name: 'Add status' })).not.toBeInTheDocument()
    const incomingType = screen.getByRole('group', { name: 'Incoming type' })
    await user.click(within(incomingType).getByRole('button', { name: 'Genre' }))
    expect(within(incomingType).getByRole('button', { name: 'Genre' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const targetType = screen.getByRole('group', { name: 'Redirect to type' })
    expect(within(targetType).getByRole('button', { name: 'Tag' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(dictionaries).getByRole('button', { name: 'Statuses' }))
    expect(screen.queryByRole('region', { name: 'Metadata rules' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add status' })).toBeInTheDocument()
  })
  it('creates a redirect with two autocomplete rows and no separate Search/Choose fields', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getGenres).mockResolvedValue({
      skip: 0,
      take: 100,
      total: 1,
      data: [{ id: 'adult', name: 'Adult', description: null }],
    })
    renderWithProviders(<AdminMetadataManager />)
    await user.click(screen.getByRole('button', { name: 'Rules' }))
    const incoming = screen.getByRole('combobox', { name: 'Incoming name' })
    await user.type(incoming, 'Angel')
    await user.click(await screen.findByRole('option', { name: 'Add "Angel"' }))
    const targetType = screen.getByRole('group', { name: 'Redirect to type' })
    await user.click(within(targetType).getByRole('button', { name: 'Genre' }))
    await user.type(screen.getByRole('combobox', { name: 'Redirect to' }), 'Adult')
    await user.click(await screen.findByRole('option', { name: 'Adult' }))
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
    expect(document.querySelector('select')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save rule' }))
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('/admin/metadata/aliases', {
        method: 'PUT',
        body: { sourceKind: 'tag', name: 'Angel', tagId: null, genreId: 'adult' },
      }),
    )
  })

  it('loads more tags without descriptions by scrolling', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => ({
      id: `tag-${i}`,
      name: `Undescribed ${i}`,
      booksCount: 1,
      aliases: [],
    }))
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ data: firstPage, total: 51 })
      .mockResolvedValueOnce({
        data: [{ id: 'last', name: 'Last undescribed tag', booksCount: 0, aliases: [] }],
        total: 51,
      })
    renderWithProviders(<AdminMetadataManager />)
    await userEvent.click(screen.getByRole('button', { name: 'Rules' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tags without descriptions' }))
    await screen.findByText('Undescribed 49')
    const list = screen.getByLabelText('Metadata policy entries')
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, value: 850 },
      clientHeight: { configurable: true, value: 100 },
    })
    fireEvent.scroll(list)
    expect(await screen.findByText('Last undescribed tag')).toBeInTheDocument()
    expect(apiRequest).toHaveBeenCalledWith('/admin/metadata/review?skip=50&take=50')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })
})
