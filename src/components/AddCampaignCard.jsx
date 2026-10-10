/**
 * AddCampaignCard
 * The left-most card in the campaigns grid.
 * Single responsibility: trigger creation of a new campaign.
 * Styled as a #F9F0E0 box with a centered plus icon.
 */
import { Plus } from 'lucide-react'
import './AddCampaignCard.css'

function AddCampaignCard({ onAdd }) {
  return (
    <button
      type="button"
      className="add-campaign"
      onClick={onAdd}
      aria-label="Add campaign"
    >
      <Plus
        className="add-campaign__plus"
        size={56}
        strokeWidth={1.5}
        aria-hidden="true"
      />
    </button>
  )
}

export default AddCampaignCard
