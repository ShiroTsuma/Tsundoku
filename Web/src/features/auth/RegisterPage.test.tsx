import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { HttpError } from '@/api/http'
import { renderWithProviders } from '@/test/render'
import { RegisterPage } from './RegisterPage'

vi.mock('@/api/client', () => ({
  api: {
    register: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('RegisterPage', () => {
  it('shows password checklist only while the password field is focused', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />, { route: '/register' })

    const passwordInput = screen.getByLabelText('Password')

    expect(
      screen.queryByRole('listitem', { name: 'Missing: At least 8 characters' }),
    ).not.toBeInTheDocument()

    await user.click(passwordInput)
    await user.type(passwordInput, 'weak')

    expect(
      screen.getByRole('listitem', { name: 'Missing: At least 8 characters' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('listitem', { name: 'Missing: One uppercase letter' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Missing: One number' })).toBeInTheDocument()

    await user.tab()

    expect(
      screen.queryByRole('listitem', { name: 'Missing: At least 8 characters' }),
    ).not.toBeInTheDocument()
  })

  it('shows local field errors and keeps password requirements out of the inline error slot', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />, { route: '/register' })

    await user.type(screen.getByLabelText('Username'), 'reader')
    await user.type(screen.getByLabelText('Email'), 'reader@example.com')
    await user.type(screen.getByLabelText('Password'), 'weak')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(screen.getByLabelText('Password')).toHaveFocus()
    expect(
      screen.getByRole('listitem', { name: 'Missing: At least 8 characters' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(
        'At least 8 characters; One uppercase letter; One number; One non-alphanumeric character',
      ),
    ).not.toBeInTheDocument()
    expect(api.register).not.toHaveBeenCalled()
  })

  it('keeps password focus when submitting from the password field with form errors', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />, { route: '/register' })

    const passwordInput = screen.getByLabelText('Password')
    await user.click(passwordInput)
    await user.type(passwordInput, 'weak')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(passwordInput).toHaveFocus()
    expect(
      screen.getByRole('listitem', { name: 'Missing: At least 8 characters' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Username is required.')).toBeInTheDocument()
    expect(screen.getByText('Email address is required.')).toBeInTheDocument()
    expect(api.register).not.toHaveBeenCalled()
  })

  it('submits registration fields to the API', async () => {
    vi.mocked(api.register).mockResolvedValue({
      id: 'user-id',
      name: 'reader',
      createdAt: '2026-01-01T00:00:00Z',
    })
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />, { route: '/register' })

    await user.type(screen.getByLabelText('Username'), 'reader')
    await user.type(screen.getByLabelText('Email'), 'reader@example.com')
    await user.type(screen.getByLabelText('Password'), 'Password123!')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(api.register).toHaveBeenCalled())
    expect(vi.mocked(api.register).mock.calls[0]?.[0]).toEqual({
      username: 'reader',
      email: 'reader@example.com',
      password: 'Password123!',
    })
    expect(toast.success).toHaveBeenCalledWith('Account created. You can log in now.')
  })

  it('maps backend field errors to registration fields', async () => {
    vi.mocked(api.register).mockRejectedValue(
      new HttpError({
        type: 'Validation',
        title: 'Validation failed',
        status: 400,
        detail: 'One or more validation errors occurred.',
        instance: '/account/register',
        errors: {
          Email: ['Email is invalid.'],
          Password: ['Password must contain at least one uppercase letter.'],
        },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />, { route: '/register' })

    await user.type(screen.getByLabelText('Username'), 'reader')
    await user.type(screen.getByLabelText('Email'), 'reader@example.com')
    await user.type(screen.getByLabelText('Password'), 'Password123!')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('Email is invalid.')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
    expect(
      screen.queryByText('Password must contain at least one uppercase letter.'),
    ).not.toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('One or more validation errors occurred.')
  })

  it('maps username conflict to the username field', async () => {
    vi.mocked(api.register).mockRejectedValue(
      new HttpError({
        type: 'UsernameTakenException',
        title: 'Conflict',
        status: 409,
        detail: "Account with username 'reader' already exists.",
        instance: '/account/register',
        errors: {
          Username: ["Account with username 'reader' already exists."],
        },
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />, { route: '/register' })

    await user.type(screen.getByLabelText('Username'), 'reader')
    await user.type(screen.getByLabelText('Email'), 'reader@example.com')
    await user.type(screen.getByLabelText('Password'), 'Password123!')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(
      await screen.findByText("Account with username 'reader' already exists."),
    ).toBeInTheDocument()
  })
})
