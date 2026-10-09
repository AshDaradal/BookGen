/**
 * App
 * Homepage composition: navigation + Campaigns section.
 * Owns the campaign list state and passes handlers down to child components
 * (separation of concerns: state here, presentation in child components).
 */
import { useState } from 'react'
import Navbar from './components/Navbar'
import AddCampaignCard from './components/AddCampaignCard'
import CampaignCard from './components/CampaignCard'
import CampaignModal from './components/CampaignModal'
import CampaignPage from './components/CampaignPage'
import './App.css'

function App() {
  // Campaign list is the single source of truth for the grid.
  const [campaigns, setCampaigns] = useState([])
  // Incrementing counter guarantees unique ids.
  const [nextId, setNextId] = useState(1)
  // Controls whether the create-campaign modal is visible.
  const [isModalOpen, setIsModalOpen] = useState(false)
  // Holds the campaign currently open in the Campaign Page (null = home view).
  const [activeCampaign, setActiveCampaign] = useState(null)

  // Open the modal when the add-campaign card is clicked.
  const handleAdd = () => setIsModalOpen(true)

  // Build a campaign from the modal's form data, close the modal,
  // then navigate straight to its Campaign Page.
  const handleCreate = (data) => {
    const campaign = { id: nextId, ...data }
    setCampaigns((prev) => [...prev, campaign])
    setNextId((id) => id + 1)
    setIsModalOpen(false)
    setActiveCampaign(campaign)
  }

  // Remove a campaign by id (called after the user confirms).
  const handleDelete = (id) => {
    setCampaigns((prev) => prev.filter((c) => c.id !== id))
  }

  // When a campaign page is open, render it instead of the home grid.
  if (activeCampaign) {
    return (
      <>
        <Navbar />
        <CampaignPage
          campaign={activeCampaign}
          onBack={() => setActiveCampaign(null)}
        />
      </>
    )
  }

  return (
    <>
      <Navbar />

      <main className="page">
        <h1 className="page__title">Campaign</h1>

        <section className="campaign-grid" aria-label="Campaigns">
          {/* Add-campaign card stays on the left, before existing campaigns */}
          <AddCampaignCard onAdd={handleAdd} />

          {campaigns.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              onDelete={handleDelete}
              onOpen={() => setActiveCampaign(campaign)}
            />
          ))}
        </section>
      </main>

      {/* Create-campaign modal, shown only when adding a campaign */}
      {isModalOpen && (
        <CampaignModal
          onCreate={handleCreate}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  )
}

export default App
