import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useRef, useState } from 'react'
import { api } from '@/api/client'
import { HttpError } from '@/api/http'
import { Check, Circle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { AuthField, AuthFrame } from './AuthFrame'

type RegisterFormValues = {
  username: string
  email: string
  password: string
}

type RegisterFormErrors = Partial<Record<keyof RegisterFormValues | 'form', string | undefined>>

const initialValues: RegisterFormValues = {
  username: '',
  email: '',
  password: '',
}

const passwordRules = [
  { id: 'length', label: 'At least 8 characters', isMet: (value: string) => value.length >= 8 },
  { id: 'uppercase', label: 'One uppercase letter', isMet: (value: string) => /[A-Z]/.test(value) },
  { id: 'lowercase', label: 'One lowercase letter', isMet: (value: string) => /[a-z]/.test(value) },
  { id: 'number', label: 'One number', isMet: (value: string) => /[0-9]/.test(value) },
  {
    id: 'symbol',
    label: 'One non-alphanumeric character',
    isMet: (value: string) => /[^a-zA-Z0-9]/.test(value),
  },
] as const

export function RegisterPage() {
  const navigate = useNavigate()
  const [values, setValues] = useState<RegisterFormValues>(initialValues)
  const [errors, setErrors] = useState<RegisterFormErrors>({})
  const [passwordFocused, setPasswordFocused] = useState(false)
  const passwordInputRef = useRef<HTMLInputElement | null>(null)
  const mutation = useMutation({
    mutationFn: api.register,
    onSuccess: () => {
      toast.success('Account created. You can log in now.')
      void navigate('/login', { replace: true })
    },
    onError: (error) => {
      if (error instanceof HttpError) {
        const nextErrors = mapApiErrors(error)
        setErrors(nextErrors)
        if (nextErrors.password) {
          passwordInputRef.current?.focus()
        }
        toast.error(nextErrors.form ?? error.apiError.detail)
        return
      }

      setErrors({ form: 'Failed to create account.' })
      toast.error('Failed to create account.')
    },
  })

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationErrors = validate(values)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length) {
      if (validationErrors.password) {
        passwordInputRef.current?.focus()
      }
      return
    }

    mutation.mutate({
      ...values,
      username: values.username.trim(),
      email: values.email.trim(),
    })
  }

  function updateField(field: keyof RegisterFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }))
  }

  const passwordInvalid = Boolean(errors.password)
  const showChecklist = passwordFocused || passwordInvalid
  const checklist = showChecklist ? (
    <ul
      aria-label="Password requirements"
      className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]"
    >
      {passwordRules.map((rule) => {
        const met = rule.isMet(values.password)
        return (
          <li
            aria-label={`${met ? 'Met' : 'Missing'}: ${rule.label}`}
            className={cn(
              'flex items-center gap-1.5',
              met ? 'text-status-finished-ink' : 'text-ink-3',
            )}
            key={rule.id}
          >
            {met ? (
              <Check aria-hidden="true" className="size-3.5" />
            ) : (
              <Circle aria-hidden="true" className="size-3.5" />
            )}
            {rule.label}
          </li>
        )
      })}
    </ul>
  ) : null

  return (
    <AuthFrame
      description="Make an account to start tracking what you read."
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-medium text-ink underline underline-offset-4" to="/login">
            Log in
          </Link>
        </>
      }
      title="Create account"
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
        <AuthField
          autoCapitalize="none"
          autoComplete="username"
          error={errors.username}
          label="Username"
          name="username"
          spellCheck={false}
          value={values.username}
          onChange={(event) => updateField('username', event.target.value)}
        />
        <AuthField
          autoComplete="email"
          error={errors.email}
          label="Email"
          name="email"
          type="email"
          value={values.email}
          onChange={(event) => updateField('email', event.target.value)}
        />
        <AuthField
          aria-invalid={passwordInvalid ? 'true' : undefined}
          autoComplete="new-password"
          hint={checklist}
          label="Password"
          name="password"
          password
          ref={passwordInputRef}
          value={values.password}
          onBlur={() => setPasswordFocused(false)}
          onChange={(event) => updateField('password', event.target.value)}
          onFocus={() => setPasswordFocused(true)}
        />
        {errors.form ? (
          <p className="m-0 text-[13px] text-danger-ink" role="alert">
            {errors.form}
          </p>
        ) : null}
        <Button
          className="mt-2 w-full"
          disabled={mutation.isPending}
          size="lg"
          type="submit"
          variant="primary"
          onMouseDown={(event) => event.preventDefault()}
        >
          {mutation.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthFrame>
  )
}

function validate(values: RegisterFormValues): RegisterFormErrors {
  const nextErrors: RegisterFormErrors = {}
  const username = values.username.trim()
  const email = values.email.trim()

  if (!username) {
    nextErrors.username = 'Username is required.'
  } else if (username.length < 3) {
    nextErrors.username = 'Username must be at least 3 characters long.'
  } else if (username.length > 32) {
    nextErrors.username = "Username can't be longer than 32 characters."
  }

  if (!email) {
    nextErrors.email = 'Email address is required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    nextErrors.email = 'A valid email address is required.'
  } else if (email.length > 100) {
    nextErrors.email = "Email can't be longer than 100 characters."
  }

  const failedRules = passwordRules.filter((rule) => !rule.isMet(values.password))
  if (!values.password) {
    nextErrors.password = 'Password is required.'
  } else if (values.password.length > 128) {
    nextErrors.password = "Password can't be longer than 128 characters."
  } else if (failedRules.length) {
    nextErrors.password = failedRules.map((rule) => rule.label).join('; ')
  }

  return nextErrors
}

function mapApiErrors(error: HttpError): RegisterFormErrors {
  const nextErrors: RegisterFormErrors = {}
  const apiErrors = error.apiError.errors ?? {}

  Object.entries(apiErrors).forEach(([property, messages]) => {
    const field = normalizeFieldName(property)
    const message = messages[0]
    if (field && message) {
      nextErrors[field] = message
    }
  })

  if (!Object.keys(nextErrors).length) {
    const detail = error.apiError.detail
    if (/username/i.test(detail)) {
      nextErrors.username = detail
    } else if (/email/i.test(detail)) {
      nextErrors.email = detail
    } else {
      nextErrors.form = detail
    }
  }

  return nextErrors
}

function normalizeFieldName(property: string): keyof RegisterFormValues | null {
  const normalized = property.trim().toLowerCase()
  if (normalized === 'username') {
    return 'username'
  }

  if (normalized === 'email') {
    return 'email'
  }

  if (normalized === 'password') {
    return 'password'
  }

  return null
}
