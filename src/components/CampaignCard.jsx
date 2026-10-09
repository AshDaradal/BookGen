/**
 * CampaignCard
 * Displays a single campaign (green box) with a delete control.
 * Single responsibility: render one campaign and request its deletion.
 * Delete confirmation state is kept local so each card manages its own prompt.
 */
import { useState } from 'react'
import './CampaignCard.css'

function CampaignCard({ campaign, onDelete, onOpen }) {
  // Local flag toggles the inline "Are you sure?" confirmation overlay.
  const [confirming, setConfirming] = useState(false)

  return (
    <article className="campaign">
      {/* Delete trigger (hidden while confirming to avoid duplicate controls) */}
      {!confirming && (
        <button
          type="button"
          className="campaign__delete"
          aria-label={`Delete ${campaign.name}`}
          onClick={() => setConfirming(true)}
        >
          ×
        </button>
      )}

      {/* Campaign summary: clicking it opens the campaign page */}
      <button
        type="button"
        className="campaign__details"
        onClick={onOpen}
        aria-label={`Open ${campaign.name}`}
      >
        <span className="campaign__name">{campaign.name}</span>
        <dl className="campaign__meta">
          <div className="campaign__row">
            <dt>Category</dt>
            <dd>{campaign.category}</dd>
          </div>
          <div className="campaign__row">
            <dt>Theme</dt>
            <dd>{campaign.theme}</dd>
          </div>
          <div className="campaign__row">
            <dt>Age range</dt>
            <dd>{campaign.ageRange}</dd>
          </div>
          <div className="campaign__row">
            <dt>Books</dt>
            <dd>{campaign.bookAmount}</dd>
          </div>
        </dl>
      </button>

      {/* Inline confirmation prompt */}
      {confirming && (
        <div className="campaign__confirm" role="alertdialog" aria-label="Confirm delete">
          <p className="campaign__confirm-text">Are you sure?</p>
          <div className="campaign__confirm-actions">
            <button
              type="button"
              className="campaign__btn campaign__btn--yes"
              onClick={() => onDelete(campaign.id)}
            >
              Yes
            </button>
            <button
              type="button"
              className="campaign__btn campaign__btn--no"
              onClick={() => setConfirming(false)}
            >
              No
            </button>
          </div>
        </div>
      )}
    </article>
  )
}

export default CampaignCard
