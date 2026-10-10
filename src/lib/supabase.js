import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

// Map a campaigns row to the shape the UI components use.
export const toCampaign = (row) => ({
  id: row.id,
  name: row.name,
  category: row.category,
  theme: row.theme,
  ageRange: row.age_range,
  bookAmount: row.book_count,
  status: row.status,
})

// Public URL of an image in the book-images bucket. With `width`, returns a
// compressed copy (Supabase image transformations); without it, the original.
// Width alone makes the transform keep the original height and crop to a
// strip, so the height is set to the A4 ratio (1536x2172) and resize is
// `contain` to keep the whole page.
export const imageUrl = (path, width) =>
  supabase.storage
    .from('book-images')
    .getPublicUrl(
      path,
      width
        ? {
            transform: {
              width,
              height: Math.round((width * 2172) / 1536),
              resize: 'contain',
              quality: 70,
            },
          }
        : undefined,
    ).data.publicUrl

// Insert or replace a row in a list (by id), keeping it sorted by `sortKey`.
export const upsertRow = (rows, row, sortKey) =>
  [...rows.filter((r) => r.id !== row.id), row].sort(
    (a, b) => a[sortKey] - b[sortKey],
  )
