import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { useAuth } from '@/features/auth/useAuth'
import { AppShell } from '@/components/app/AppShell'
import { AdminPage } from '@/features/admin/AdminPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { RegisterPage } from '@/features/auth/RegisterPage'
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage'
import { BookDetailsPage } from '@/features/books/BookDetailsPage'
import { BookFormPage } from '@/features/books/BookFormPage'
import { CoverUploadOutbox } from '@/features/books/CoverUploadOutboxWorker'
import { BooksPage } from '@/features/books/BooksPage'
import { ManagePage } from '@/features/manage/ManagePage'
import { DiscoverPage } from '@/features/discover/DiscoverPage'
import { EpubDownloadNotifications } from '@/features/epubSearch/EpubDownloadNotifications'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<ProtectedLayout />}>
              <Route path="/books" element={<BooksPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/manage" element={<ManagePage />} />
              <Route path="/discover" element={<DiscoverPage />} />
              <Route path="/books/new" element={<BookFormPage mode="create" />} />
              <Route path="/books/:id" element={<BookDetailsPage />} />
              <Route path="/books/:id/edit" element={<BookFormPage mode="edit" />} />
              <Route
                path="/admin"
                element={
                  <AdminOnly>
                    <AdminPage />
                  </AdminOnly>
                }
              />
              <Route
                path="/admin/books/:id/edit"
                element={
                  <AdminOnly>
                    <BookFormPage admin mode="edit" />
                  </AdminOnly>
                }
              />
              <Route path="/" element={<Navigate to="/books" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/books" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  )
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()

  if (!isAdmin) {
    return <Navigate to="/books" replace />
  }

  return children
}

function ProtectedLayout() {
  const { isAuthenticated, isRestoring } = useAuth()

  if (isRestoring) {
    return <main aria-busy="true" aria-label="Restoring session" />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return (
    <>
      <CoverUploadOutbox />
      <EpubDownloadNotifications />
      <AppShell />
    </>
  )
}
