/**
 * CampaignModal
 * Modal form for creating a new campaign.
 * Single responsibility: collect campaign details and emit them on submit.
 * Form state is kept local; the parent only receives the final payload.
 */
import { useState } from 'react'
import { X } from 'lucide-react'
import './CampaignModal.css'

// Category options for the category dropdown.
const CATEGORIES = [
  'Animals',
  'Vehicles',
  'Fantasy',
  'Nature',
  'Holidays',
  'Kids',
  'Adults',
  'Educational',
]

// Age-range options for the audience dropdown.
const AGE_RANGES = ['2-3', '3-5', '5-9', '9-12', '18 and above']

function CampaignModal({ onCreate, onClose }) {
  // Each field is tracked independently so inputs stay controlled.
  const [name, setName] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [theme, setTheme] = useState('')
  const [ageRange, setAgeRange] = useState(AGE_RANGES[0])
  const [bookAmount, setBookAmount] = useState(1)

  // Collect the form into a single payload and hand it to the parent.
  const handleSubmit = (e) => {
    e.preventDefault()
    onCreate({ name, category, theme, ageRange, bookAmount })
  }

  // Clamp the numeric up/down control to a sensible minimum of 1.
  const handleBookAmount = (value) => {
    const n = Number(value)
    setBookAmount(Number.isNaN(n) || n < 1 ? 1 : n)
  }

  return (
    // Clicking the dark overlay (outside the dialog) cancels creation.
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create campaign"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button to cancel creating a campaign */}
        <button
          type="button"
          className="modal__close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={16} strokeWidth={2.5} aria-hidden="true" />
        </button>

        <form className="modal__form" onSubmit={handleSubmit}>
          <label className="modal__field">
            <span className="modal__label">Give your campaign a name.</span>
            <input
              type="text"
              className="modal__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <label className="modal__field">
            <span className="modal__label">Category?</span>
            <select
              className="modal__input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>

          <label className="modal__field">
            <span className="modal__label">Theme? (e.g. cute forest animals)</span>
            <input
              type="text"
              className="modal__input"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              required
            />
          </label>

          <label className="modal__field">
            <span className="modal__label">Age range for audience?</span>
            <select
              className="modal__input"
              value={ageRange}
              onChange={(e) => setAgeRange(e.target.value)}
            >
              {AGE_RANGES.map((range) => (
                <option key={range} value={range}>
                  {range}
                </option>
              ))}
            </select>
          </label>

          <label className="modal__field">
            <span className="modal__label">How many books should I create?</span>
            {/* Numeric up/down control (native number spinner) */}
            <input
              type="number"
              className="modal__input"
              min="1"
              step="1"
              value={bookAmount}
              onChange={(e) => handleBookAmount(e.target.value)}
            />
          </label>

          <button type="submit" className="modal__submit">
            Create my campaign
          </button>
        </form>
      </div>
    </div>
  )
}

export default CampaignModal
