/**
 * App
 * Homepage composition: navigation + Campaigns section.
 * Owns the campaign list state and passes handlers down to child components
 * (separation of concerns: state here, presentation in child components).
 */
import { useEffect, useState } from 'react'
import Navbar from './components/Navbar'
import AddCampaignCard from './components/AddCampaignCard'
import CampaignCard from './components/CampaignCard'
import CampaignModal from './components/CampaignModal'
import CampaignPage from './components/CampaignPage'
import { supabase, toCampaign } from './lib/supabase'
import './App.css'

function App() {
  // Campaign list mirrors the campaigns table.
  const [campaigns, setCampaigns] = useState([])
  // Controls whether the create-campaign modal is visible.
  const [isModalOpen, setIsModalOpen] = useState(false)
  // Holds the campaign currently open in the Campaign Page (null = home view).
  const [activeCampaign, setActiveCampaign] = useState(null)

  useEffect(() => {
    supabase
      .from('campaigns')
      .select('*')
      .order('created_at')
      .then(({ data, error }) => {
        if (error) alert(`Could not load campaigns: ${error.message}`)
        else setCampaigns(data.map(toCampaign))
      })
  }, [])

  // Open the modal when the add-campaign card is clicked.
  const handleAdd = () => setIsModalOpen(true)

  // Insert the campaign (a DB trigger queues the concepts job),
  // then navigate straight to its Campaign Page.
  const handleCreate = async (data) => {
    const { data: row, error } = await supabase
      .from('campaigns')
      .insert({
        name: data.name,
        category: data.category,
        theme: data.theme,
        age_range: data.ageRange,
        book_count: Number(data.bookAmount),
      })
      .select()
      .single()
    if (error) {
      alert(`Could not create campaign: ${error.message}`)
      return
    }
    const campaign = toCampaign(row)
    setCampaigns((prev) => [...prev, campaign])
    setIsModalOpen(false)
    setActiveCampaign(campaign)
  }

  // Remove a campaign by id (called after the user confirms).
  const handleDelete = async (id) => {
    const { error } = await supabase.from('campaigns').delete().eq('id', id)
    if (error) {
      alert(`Could not delete campaign: ${error.message}`)
      return
    }
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
