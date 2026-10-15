import { describe, expect, it } from 'vitest'
import type { BookImportRowDto, BookImportSessionDto } from '@/api/types'
import { findClosestOption, getImportIssueGroups } from './bookImportStats'

function row(partial: Partial<BookImportRowDto>): BookImportRowDto {
  return { rowId: 'r', lineNumber: 2, isValid: false, errors: [], fieldErrors: {}, ...partial }
}

const statusError = 'Status is required and must exist. Allowed values: Reading, Completed.'
const duplicateError = 'A book with this title and content type already exists in your library.'

const session: BookImportSessionDto = {
  sessionId: 's',
  fileName: 'books.csv',
  totalRows: 4,
  validRows: 1,
  invalidRows: 3,
  canFinalize: false,
  availableContentTypes: ['Novel', 'Manga'],
  availableStatuses: ['Reading', 'Completed', 'Plan To Read'],
  rows: [
    row({
      rowId: 'a',
      status: 'Readin',
      errors: [statusError],
      fieldErrors: { status: [statusError] },
    }),
    row({
      rowId: 'b',
      status: 'readin',
      errors: [statusError],
      fieldErrors: { status: [statusError] },
    }),
    row({
      rowId: 'c',
      errors: [duplicateError],
      fieldErrors: { primaryTitle: [duplicateError] },
    }),
    row({ rowId: 'd', isValid: true }),
  ],
}

describe('getImportIssueGroups', () => {
  it('groups rows with the same misspelt status and suggests the allowed value', () => {
    const groups = getImportIssueGroups(session)

    expect(groups[0]).toMatchObject({
      label: 'Status “Readin” does not exist',
      field: 'status',
      suggestion: 'Reading',
      rowIds: ['a', 'b'],
    })
    expect(groups[1]).toMatchObject({ label: duplicateError, rowIds: ['c'] })
    expect(groups[1]?.field).toBeUndefined()
    expect(groups).toHaveLength(2)
  })
})

describe('findClosestOption', () => {
  it('matches typos and prefixes but not unrelated values', () => {
    expect(findClosestOption('Readin', ['Reading', 'Completed'])).toBe('Reading')
    expect(findClosestOption('complted', ['Reading', 'Completed'])).toBe('Completed')
    expect(findClosestOption('plan', ['Reading', 'Plan To Read'])).toBe('Plan To Read')
    expect(findClosestOption('Webtoon', ['Novel', 'Manga'])).toBeUndefined()
  })
})
