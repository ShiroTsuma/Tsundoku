import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { renderWithProviders } from '@/test/render'
import { LoginPage } from './LoginPage'

vi.mock('@/api/client', () => ({
  api: {
    login: vi.fn(),
  },
}))

vi.mock('./useAuth', () => ({
  useAuth: () => ({ setSession: vi.fn() }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('LoginPage', () => {
  it('labels the fields for password managers and can show the password', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, { route: '/login' })

    const identifier = screen.getByLabelText('Email or username')
    const password = screen.getByLabelText('Password')
    expect(identifier).toHaveAttribute('autocomplete', 'username')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    expect(password).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('sends an identifier with @ as the email and anything else as the username', async () => {
    vi.mocked(api.login).mockReturnValue(new Promise(() => undefined))
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, { route: '/login' })

    await user.type(screen.getByLabelText('Email or username'), 'reader@example.com')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    await waitFor(() =>
      expect(vi.mocked(api.login).mock.calls[0]?.[0]).toEqual({
        email: 'reader@example.com',
        username: null,
        password: 'secret',
      }),
    )
    expect(screen.getByRole('button', { name: 'Logging in…' })).toBeDisabled()
  })
})
