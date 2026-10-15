import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { renderWithProviders } from '@/test/render'
import { AdminMetadataManager } from './AdminMetadataManager'

vi.mock('@/api/client', () => ({
  api: {
    getStatuses: vi.fn(),
    getTypes: vi.fn(),
    getGenres: vi.fn(),
    searchAdminGlobalTags: vi.fn(),
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
})
