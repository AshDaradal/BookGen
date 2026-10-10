/**
 * CampaignPage
 * Full editing view for a single campaign, shown after creation.
 * Single responsibility: lay out the campaign workspace (left controls,
 * middle book preview, right book list) backed by the database.
 *
 * Data:
 *   books = rows of `books` for this campaign (Realtime-synced)
 *   pages = rows of `pages` for the selected book (Realtime-synced)
 * The carousel shows the cover first, then the pages. The selected book +
 * selected item drive both the preview and the editors.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase, imageUrl, upsertRow } from '../lib/supabase'
import './CampaignPage.css'

// Download scope options shared by the download controls.
const DOWNLOAD_SCOPES = ['Current Book', 'All Books']

// Row status -> label shown in the UI.
const STATUS_LABELS = {
  queued: 'Queued',
  processing: 'Generating',
  succeeded: 'Ready',
  failed: 'Failed',
}

// Compressed width for gallery thumbnails (the preview uses the original).
const THUMB_WIDTH = 300

const isPending = (status) => status === 'queued' || status === 'processing'

function Spinner() {
  return <span className="cp-spinner" aria-hidden="true" />
}

// Image, spinner, or fallback text for one carousel item.
function Illustration({ item, width, pendingText, emptyText }) {
  if (item.path) {
    return (
      <img
        className="cp-img"
        src={imageUrl(item.path, width)}
        alt={item.label}
        loading="lazy"
      />
    )
  }
  if (item.pending) {
    return (
      <span className="cp-state">
        <Spinner />
        {pendingText}
      </span>
    )
  }
  return (
    <span className="cp-state">{item.failed ? 'Failed' : emptyText}</span>
  )
}

function CampaignPage({ campaign, onBack }) {
  const [campaignStatus, setCampaignStatus] = useState(campaign.status)
  const [books, setBooks] = useState([])
  const [booksLoaded, setBooksLoaded] = useState(false)
  const [pages, setPages] = useState([])
  // Which book is selected (null = first book).
  const [selectedBookId, setSelectedBookId] = useState(null)
  // Which carousel item is active (0 = cover).
  const [pageIndex, setPageIndex] = useState(0)
  // Left panel edits either the current "Page" or the current "Book".
  const [panelMode, setPanelMode] = useState('page')
  // Amount used by the "Add more Books" control.
  const [addAmount, setAddAmount] = useState(1)
  // Selected scope for each download control.
  const [bookScope, setBookScope] = useState(DOWNLOAD_SCOPES[0])
  const [kindleScope, setKindleScope] = useState(DOWNLOAD_SCOPES[0])
  // Row being edited: { table, id, title, description } snapshot from focus.
  const editingRef = useRef(null)
  const requestRef = useRef(false)
  const [submitting, setSubmitting] = useState(null)

  const requestGeneration = async (action, args, targetId) => {
    if (requestRef.current) return
    requestRef.current = true
    setSubmitting(action)
    try {
      const { error } = await supabase.rpc(action, args)
      if (error) throw error
      setCampaignStatus('queued')
      if (action === 'request_revise_book') {
        setBooks((prev) => prev.map((b) => b.id === targetId ? { ...b, status: 'queued' } : b))
      } else if (action === 'request_revise_page') {
        setPages((prev) => prev.map((p) => p.id === targetId ? { ...p, status: 'queued' } : p))
        setBooks((prev) => prev.map((b) => b.id === bookId ? { ...b, status: 'queued' } : b))
      }
    } catch (error) {
      alert(`Could not request generation: ${error.message}`)
    } finally {
      requestRef.current = false
      setSubmitting(null)
    }
  }

  const selectedBook =
    books.find((b) => b.id === selectedBookId) || books[0] || null
  const bookId = selectedBook?.id

  // Keep local text for the row being edited when a Realtime update arrives.
  const keepEdits = (table, rows, row) => {
    const ed = editingRef.current
    const local = rows.find((r) => r.id === row.id)
    if (!ed || ed.table !== table || ed.id !== row.id || !local) return row
    return { ...row, title: local.title, description: local.description }
  }

  // Campaign status + books, kept live through Realtime.
  useEffect(() => {
    const channel = supabase
      .channel(`campaign-${campaign.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${campaign.id}` },
        ({ new: row }) => setCampaignStatus(row.status),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'books', filter: `campaign_id=eq.${campaign.id}` },
        ({ eventType, new: row, old }) =>
          setBooks((prev) =>
            eventType === 'DELETE'
              ? prev.filter((b) => b.id !== old.id)
              : upsertRow(prev, keepEdits('books', prev, row), 'book_number'),
          ),
      )
      .subscribe()

    supabase
      .from('campaigns')
      .select('status')
      .eq('id', campaign.id)
      .single()
      .then(({ data }) => data && setCampaignStatus(data.status))

    supabase
      .from('books')
      .select('*')
      .eq('campaign_id', campaign.id)
      .order('book_number')
      .then(({ data, error }) => {
        if (error) alert(`Could not load books: ${error.message}`)
        else setBooks(data)
        setBooksLoaded(true)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [campaign.id])

  // Pages of the selected book, kept live through Realtime.
  useEffect(() => {
    setPages([])
    if (!bookId) return

    const channel = supabase
      .channel(`pages-${bookId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pages', filter: `book_id=eq.${bookId}` },
        ({ eventType, new: row, old }) =>
          setPages((prev) =>
            eventType === 'DELETE'
              ? prev.filter((p) => p.id !== old.id)
              : upsertRow(prev, keepEdits('pages', prev, row), 'page_number'),
          ),
      )
      .subscribe()

    supabase
      .from('pages')
      .select('*')
      .eq('book_id', bookId)
      .order('page_number')
      .then(({ data, error }) => {
        if (error) alert(`Could not load pages: ${error.message}`)
        else setPages(data)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [bookId])

  // Carousel items: cover first, then the pages.
  const items = selectedBook
    ? [
        {
          key: 'cover',
          label: 'Cover',
          path: selectedBook.cover_image_path,
          pending: isPending(selectedBook.status),
          failed: false,
        },
        ...pages.map((p) => ({
          key: p.id,
          label: `Page ${p.page_number}`,
          path: p.image_path,
          pending: isPending(p.status),
          failed: p.status === 'failed',
          page: p,
        })),
      ]
    : []
  const currentItem = items[pageIndex] || items[0] || null
  const currentPage = currentItem?.page || null

  // Clamp the numeric up/down control to a minimum of 1.
  const handleAddAmount = (value) => {
    const n = Number(value)
    setAddAmount(Number.isFinite(n) ? Math.min(100, Math.max(1, Math.floor(n))) : 1)
  }

  // Local edit of the selected book / page (saved on blur).
  const updateBook = (field, value) =>
    setBooks((prev) =>
      prev.map((b) => (b.id === bookId ? { ...b, [field]: value } : b)),
    )
  const updatePage = (field, value) =>
    setPages((prev) =>
      prev.map((p) => (p.id === currentPage.id ? { ...p, [field]: value } : p)),
    )

  // Snapshot the row on focus so blur only saves real changes.
  const startEdit = (table, row) => {
    editingRef.current = {
      table,
      id: row.id,
      title: row.title,
      description: row.description,
    }
  }

  const saveEdit = async (table, row) => {
    const snap = editingRef.current
    editingRef.current = null
    if (!row || !snap || snap.table !== table || snap.id !== row.id) return
    const changes = {}
    for (const field of ['title', 'description']) {
      if (row[field] !== snap[field]) changes[field] = row[field]
    }
    if (Object.keys(changes).length === 0) return
    const { error } = await supabase.from(table).update(changes).eq('id', row.id)
    if (error) alert(`Could not save: ${error.message}`)
  }

  // Props wiring an input to a book/page field with save-on-blur.
  const bookField = (field) => ({
    value: selectedBook?.[field] ?? '',
    disabled: !selectedBook,
    onChange: (e) => updateBook(field, e.target.value),
    onFocus: () => startEdit('books', selectedBook),
    onBlur: () => saveEdit('books', selectedBook),
  })
  const pageField = (field) =>
    currentPage
      ? {
          value: currentPage[field] ?? '',
          onChange: (e) => updatePage(field, e.target.value),
          onFocus: () => startEdit('pages', currentPage),
          onBlur: () => saveEdit('pages', currentPage),
        }
      : { value: '', disabled: true, readOnly: true }

  // Select a book from the list and reset to its first item (the cover).
  const handleSelectBook = (id) => {
    setSelectedBookId(id)
    setPageIndex(0)
  }

  // Preview navigation (wraps within the selected book's items).
  const total = items.length
  const goPrev = () => total && setPageIndex((i) => (i > 0 ? i - 1 : total - 1))
  const goNext = () => total && setPageIndex((i) => (i < total - 1 ? i + 1 : 0))

  // Right column message while there are no books yet.
  const booksNote = !booksLoaded ? (
    <p className="cp-note">
      <Spinner /> Loading books...
    </p>
  ) : campaignStatus === 'failed' ? (
    <p className="cp-note">Could not generate book concepts.</p>
  ) : (
    <p className="cp-note">
      <Spinner /> Generating book concepts...
    </p>
  )

  // Gallery message while the selected book has no pages yet.
  const pagesNote =
    selectedBook && pages.length === 0 ? (
      isPending(selectedBook.status) ? (
        <span className="cp-note">
          <Spinner /> Writing pages...
        </span>
      ) : (
        <span className="cp-note">
          {selectedBook.status === 'failed' ? 'Page generation failed.' : 'No pages yet.'}
        </span>
      )
    ) : null

  return (
    <main className="campaign-page">
      <div className="campaign-page__head">
        {/* Back button sits above the page title */}
        <button type="button" className="campaign-page__back" onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={2.25} aria-hidden="true" />
          Back
        </button>
        <div className="campaign-page__heading">
          <h1 className="campaign-page__title">Campaign Page</h1>
          {/* Show which campaign this page belongs to */}
          <span className="campaign-page__name">{campaign.name}</span>
        </div>
      </div>

      {/* All controls live in one borderless workspace box */}
      <div className="campaign-page__workspace">
        <div className="campaign-page__grid">
          {/* LEFT COLUMN: Page/Book editor + action grid */}
          <aside className="cp-left">
            <section className="cp-box">
              {/* Toggle between editing the current Page or the current Book */}
              <div className="cp-box__header">
                <h2 className="cp-box__title">
                  {panelMode === 'page' ? 'Page' : 'Book'}
                </h2>
                <button
                  type="button"
                  className="cp-switch"
                  onClick={() =>
                    setPanelMode((m) => (m === 'page' ? 'book' : 'page'))
                  }
                >
                  Switch to {panelMode === 'page' ? 'Book' : 'Page'}
                </button>
              </div>

              {panelMode === 'page' ? (
                // Page editor: edits the selected page (the cover has no text)
                <>
                  <input
                    type="text"
                    className="cp-input"
                    placeholder={currentItem?.key === 'cover' ? 'Cover' : 'Page Title'}
                    {...pageField('title')}
                  />
                  {/* Description is ~3x the height of a standard input */}
                  <textarea
                    className="cp-input cp-input--textarea"
                    placeholder={
                      currentItem?.key === 'cover'
                        ? 'The cover uses the book title. Switch to Book to edit it.'
                        : 'Page Description'
                    }
                    {...pageField('description')}
                  />
                </>
              ) : (
                // Book editor: edits the selected book's own title/description
                <>
                  <input
                    type="text"
                    className="cp-input"
                    placeholder="Book Title"
                    {...bookField('title')}
                  />
                  <textarea
                    className="cp-input cp-input--textarea"
                    placeholder="Book Description"
                    {...bookField('description')}
                  />
                </>
              )}
            </section>

            {/* 6-cell action grid, in the required order */}
            <section className="cp-actions">
              {/* Row 1 */}
              <button
                type="button"
                className="cp-btn"
                disabled={!!submitting || !selectedBook || isPending(selectedBook.status)}
                aria-busy={submitting === 'request_revise_book'}
                onClick={() => requestGeneration('request_revise_book', { p_book_id: bookId }, bookId)}
              >
                {submitting === 'request_revise_book' ? 'Requesting revision...' : 'Revise Whole Book'}
              </button>
              <button
                type="button"
                className="cp-btn"
                disabled={!!submitting || !currentPage || isPending(currentPage.status) || isPending(selectedBook?.status)}
                aria-busy={submitting === 'request_revise_page'}
                onClick={() => requestGeneration('request_revise_page', { p_page_id: currentPage.id }, currentPage.id)}
              >
                {submitting === 'request_revise_page' ? 'Requesting revision...' : 'Revise Page Only'}
              </button>

              {/* Row 2 */}
              <input
                type="number"
                className="cp-input cp-add__num"
                min="1"
                max="100"
                disabled={!!submitting || isPending(campaignStatus)}
                step="1"
                value={addAmount}
                onChange={(e) => handleAddAmount(e.target.value)}
                aria-label="Number of books to add"
              />
              <button
                type="button"
                className="cp-btn"
                disabled={!!submitting || isPending(campaignStatus)}
                aria-busy={submitting === 'request_add_books'}
                onClick={() => requestGeneration('request_add_books', { p_campaign_id: campaign.id, p_count: addAmount })}
              >
                {submitting === 'request_add_books' ? 'Requesting books...' : isPending(campaignStatus) && books.length > 0 ? 'Campaign busy...' : 'Add more Books'}
              </button>

              {/* Row 3: downloads, each with a scope dropdown */}
              <div className="cp-download">
                <button type="button" className="cp-btn">
                  Download Book
                </button>
                <select
                  className="cp-input cp-download__scope"
                  value={bookScope}
                  onChange={(e) => setBookScope(e.target.value)}
                >
                  {DOWNLOAD_SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {scope}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cp-download">
                <button type="button" className="cp-btn">
                  Download Kindle
                </button>
                <select
                  className="cp-input cp-download__scope"
                  value={kindleScope}
                  onChange={(e) => setKindleScope(e.target.value)}
                >
                  {DOWNLOAD_SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {scope}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          </aside>

          {/* MIDDLE COLUMN: editable book title + page preview */}
          <section className="cp-middle">
            <input
              type="text"
              className="cp-book-title"
              placeholder="Book title"
              aria-label="Book title"
              {...bookField('title')}
            />

            <div className="cp-preview">
              <button
                type="button"
                className="cp-preview__arrow"
                onClick={goPrev}
                aria-label="Previous page"
              >
                <ChevronLeft size={22} strokeWidth={2.25} aria-hidden="true" />
              </button>

              <div className="cp-preview__page">
                {currentItem ? (
                  <>
                    <Illustration
                      item={currentItem}
                      pendingText="Generating illustration..."
                      emptyText="No illustration yet"
                    />
                    <span className="cp-preview__label">{currentItem.label}</span>
                  </>
                ) : (
                  <span className="cp-state">No book selected</span>
                )}
              </div>

              <button
                type="button"
                className="cp-preview__arrow"
                onClick={goNext}
                aria-label="Next page"
              >
                <ChevronRight size={22} strokeWidth={2.25} aria-hidden="true" />
              </button>
            </div>
          </section>

          {/* RIGHT COLUMN: scrollable, selectable list of books */}
          <aside className="cp-right">
            <div className="cp-books">
              {books.length === 0 && booksNote}
              {books.map((book) => (
                <button
                  type="button"
                  key={book.id}
                  className={
                    'cp-book' + (book.id === bookId ? ' cp-book--active' : '')
                  }
                  onClick={() => handleSelectBook(book.id)}
                  aria-current={book.id === bookId ? 'true' : undefined}
                >
                  <h3 className="cp-book__title">{book.title}</h3>
                  <p className="cp-book__desc">
                    {book.description || 'No description yet.'}
                  </p>
                  <span className="cp-book__status">
                    {isPending(book.status) && <Spinner />}
                    Status: {STATUS_LABELS[book.status] || book.status}
                  </span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      </div>

      {/* PAGE GALLERY: selecting a thumbnail updates the middle preview */}
      <section className="cp-gallery">
        <div className="cp-gallery__head">
          <h2 className="cp-gallery__title">Pages</h2>
          {pagesNote}
        </div>
        <div className="cp-gallery__grid">
          {items.map((item, index) => (
            <button
              type="button"
              key={item.key}
              className={
                'cp-gallery__item' +
                (index === pageIndex ? ' cp-gallery__item--active' : '')
              }
              onClick={() => setPageIndex(index)}
              aria-label={`Go to ${item.label.toLowerCase()}`}
              aria-current={index === pageIndex ? 'true' : undefined}
            >
              <Illustration item={item} width={THUMB_WIDTH} emptyText="" />
              <span className="cp-gallery__label">{item.label}</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}

export default CampaignPage
