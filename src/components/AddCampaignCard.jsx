/**
 * AddCampaignCard
 * The left-most card in the campaigns grid.
 * Single responsibility: trigger creation of a new campaign.
 * Styled as a #F9F0E0 box with a centered "+" sign.
 */
import './AddCampaignCard.css'

function AddCampaignCard({ onAdd }) {
  return (
    <button
      type="button"
      className="add-campaign"
      onClick={onAdd}
      aria-label="Add campaign"
    >
      <span className="add-campaign__plus" aria-hidden="true">
        +
      </span>
    </button>
  )
}

export default AddCampaignCard
