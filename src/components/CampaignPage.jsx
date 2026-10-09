/**
 * CampaignPage
 * Full editing view for a single campaign, shown after creation.
 * Single responsibility: lay out the campaign workspace (left controls,
 * middle book preview, right book list) and manage local editing state.
 *
 * Data model:
 *   book  = { id, title, description, status, pages: [page] }
 *   page  = { id, title, description }
 * The selected book + selected page drive both the preview and the editors.
 */
import { useState } from 'react'
import './CampaignPage.css'

// Download scope options shared by the download controls.
const DOWNLOAD_SCOPES = ['Current Book', 'All Books']

// Build an empty set of pages for a new book.
const buildPages = () =>
  Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    title: '',
    description: '',
  }))

// Build the initial book list from the campaign's requested book amount.
const buildBooks = (amount) =>
  Array.from({ length: Math.max(1, Number(amount) || 1) }, (_, i) => ({
    id: i + 1,
    title: `Book ${i + 1}`,
    description: '',
    status: 'Draft',
    pages: buildPages(),
  }))

function CampaignPage({ campaign, onBack }) {
  // Books are the single source of truth; each carries its own pages.
  const [books, setBooks] = useState(() => buildBooks(campaign.bookAmount))
  // Which book is currently selected (right column + middle preview).
  const [selectedBookId, setSelectedBookId] = useState(1)
  // Which page of the selected book is active.
  const [pageIndex, setPageIndex] = useState(0)
  // Left panel edits either the current "Page" or the current "Book".
  const [panelMode, setPanelMode] = useState('page')
  // Amount used by the "Add more Books" control.
  const [addAmount, setAddAmount] = useState(1)
  // Selected scope for each download control.
  const [bookScope, setBookScope] = useState(DOWNLOAD_SCOPES[0])
  const [kindleScope, setKindleScope] = useState(DOWNLOAD_SCOPES[0])

  // Derived selections used throughout the view.
  const selectedBook = books.find((b) => b.id === selectedBookId) || books[0]
  const pages = selectedBook.pages
  const totalPages = pages.length
  const currentPage = pages[pageIndex] || pages[0]

  // Clamp the numeric up/down control to a minimum of 1.
  const handleAddAmount = (value) => {
    const n = Number(value)
    setAddAmount(Number.isNaN(n) || n < 1 ? 1 : n)
  }

  // Append the requested number of books to the right-hand list.
  const handleAddBooks = () => {
    setBooks((prev) => {
      const start = prev.length
      const extra = Array.from({ length: addAmount }, (_, i) => ({
        id: start + i + 1,
        title: `Book ${start + i + 1}`,
        description: '',
        status: 'Draft',
        pages: buildPages(),
      }))
      return [...prev, ...extra]
    })
  }

  // Update a field on the selected book (immutably).
  const updateBook = (field, value) => {
    setBooks((prev) =>
      prev.map((b) =>
        b.id === selectedBookId ? { ...b, [field]: value } : b
      )
    )
  }

  // Update a field on the selected page of the selected book (immutably).
  const updatePage = (field, value) => {
    setBooks((prev) =>
      prev.map((b) =>
        b.id === selectedBookId
          ? {
              ...b,
              pages: b.pages.map((p, i) =>
                i === pageIndex ? { ...p, [field]: value } : p
              ),
            }
          : b
      )
    )
  }

  // Select a book from the list and reset to its first page.
  const handleSelectBook = (id) => {
    setSelectedBookId(id)
    setPageIndex(0)
  }

  // Preview navigation (wraps within the selected book's page range).
  const goPrev = () => setPageIndex((i) => (i > 0 ? i - 1 : totalPages - 1))
  const goNext = () => setPageIndex((i) => (i < totalPages - 1 ? i + 1 : 0))

  return (
    <main className="campaign-page">
      <div className="campaign-page__head">
        {/* Back button sits above the page title */}
        <button type="button" className="campaign-page__back" onClick={onBack}>
          ← Back
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
                // Page editor: edits the selected page of the selected book
                <>
                  <input
                    type="text"
                    className="cp-input"
                    placeholder="Page Title"
                    value={currentPage.title}
                    onChange={(e) => updatePage('title', e.target.value)}
                  />
                  {/* Description is ~3x the height of a standard input */}
                  <textarea
                    className="cp-input cp-input--textarea"
                    placeholder="Page Description"
                    value={currentPage.description}
                    onChange={(e) => updatePage('description', e.target.value)}
                  />
                </>
              ) : (
                // Book editor: edits the selected book's own title/description
                <>
                  <input
                    type="text"
                    className="cp-input"
                    placeholder="Book Title"
                    value={selectedBook.title}
                    onChange={(e) => updateBook('title', e.target.value)}
                  />
                  <textarea
                    className="cp-input cp-input--textarea"
                    placeholder="Book Description"
                    value={selectedBook.description}
                    onChange={(e) => updateBook('description', e.target.value)}
                  />
                </>
              )}
            </section>

            {/* 6-cell action grid, in the required order */}
            <section className="cp-actions">
              {/* Row 1 */}
              <button type="button" className="cp-btn">
                Revise Whole Book
              </button>
              <button type="button" className="cp-btn">
                Revise Page Only
              </button>

              {/* Row 2 */}
              <input
                type="number"
                className="cp-input cp-add__num"
                min="1"
                step="1"
                value={addAmount}
                onChange={(e) => handleAddAmount(e.target.value)}
                aria-label="Number of books to add"
              />
              <button type="button" className="cp-btn" onClick={handleAddBooks}>
                Add more Books
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
              value={selectedBook.title}
              onChange={(e) => updateBook('title', e.target.value)}
              aria-label="Book title"
            />

            <div className="cp-preview">
              <button
                type="button"
                className="cp-preview__arrow"
                onClick={goPrev}
                aria-label="Previous page"
              >
                ‹
              </button>

              <div className="cp-preview__page">
                <span className="cp-preview__label">Page {pageIndex + 1}</span>
              </div>

              <button
                type="button"
                className="cp-preview__arrow"
                onClick={goNext}
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          </section>

          {/* RIGHT COLUMN: scrollable, selectable list of books */}
          <aside className="cp-right">
            <div className="cp-books">
              {books.map((book) => (
                <button
                  type="button"
                  key={book.id}
                  className={
                    'cp-book' +
                    (book.id === selectedBookId ? ' cp-book--active' : '')
                  }
                  onClick={() => handleSelectBook(book.id)}
                  aria-current={book.id === selectedBookId ? 'true' : undefined}
                >
                  <h3 className="cp-book__title">{book.title}</h3>
                  <p className="cp-book__desc">
                    {book.description || 'No description yet.'}
                  </p>
                  <span className="cp-book__status">Status: {book.status}</span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      </div>

      {/* PAGE GALLERY: selecting a thumbnail updates the middle preview */}
      <section className="cp-gallery">
        <h2 className="cp-gallery__title">Pages</h2>
        <div className="cp-gallery__grid">
          {pages.map((page, index) => (
            <button
              type="button"
              key={page.id}
              className={
                'cp-gallery__item' +
                (index === pageIndex ? ' cp-gallery__item--active' : '')
              }
              onClick={() => setPageIndex(index)}
              aria-label={`Go to page ${index + 1}`}
              aria-current={index === pageIndex ? 'true' : undefined}
            >
              Page {index + 1}
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}

export default CampaignPage
