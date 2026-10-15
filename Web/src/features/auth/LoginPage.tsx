import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { HttpError } from '@/api/http'
import { Button } from '@/components/ui/Button'
import { AuthField, AuthFrame } from './AuthFrame'
import { useAuth } from './useAuth'

export function LoginPage() {
  const { setSession } = useAuth()
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: api.login,
    onSuccess: (response) => {
      setSession(response)
      void navigate('/books', { replace: true })
    },
    onError: (error) => {
      toast.error(error instanceof HttpError ? error.apiError.detail : 'Failed to log in.')
    },
  })

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const identifier = readFormString(formData, 'identifier').trim()
    mutation.mutate({
      email: identifier.includes('@') ? identifier : null,
      username: identifier.includes('@') ? null : identifier,
      password: readFormString(formData, 'password'),
    })
  }

  return (
    <AuthFrame
      description="Welcome back to your library."
      footer={
        <>
          No account yet?{' '}
          <Link className="font-medium text-ink underline underline-offset-4" to="/register">
            Create one
          </Link>
        </>
      }
      title="Log in"
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <AuthField
          autoCapitalize="none"
          autoComplete="username"
          label="Email or username"
          name="identifier"
          required
          spellCheck={false}
          type="text"
        />
        <AuthField
          autoComplete="current-password"
          label="Password"
          name="password"
          password
          required
        />
        <Button
          className="mt-2 w-full"
          disabled={mutation.isPending}
          size="lg"
          type="submit"
          variant="primary"
        >
          {mutation.isPending ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
    </AuthFrame>
  )
}

function readFormString(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}
