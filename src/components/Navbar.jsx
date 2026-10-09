/**
 * Navbar
 * Top navigation bar with the primary app sections.
 * Single responsibility: render nav links and track the active item.
 */
import { useState } from 'react'
import './Navbar.css'

// Nav items are declared as data so the markup stays declarative and easy to extend.
const NAV_ITEMS = ['Home', 'Auto-post', 'Link Socials', 'Content-input']

function Navbar() {
  const [active, setActive] = useState('Home')

  return (
    <nav className="navbar" aria-label="Primary">
      <span className="navbar__brand">BookGen</span>

      <ul className="navbar__links">
        {NAV_ITEMS.map((item) => (
          <li key={item}>
            <button
              type="button"
              className={
                'navbar__link' + (active === item ? ' navbar__link--active' : '')
              }
              aria-current={active === item ? 'page' : undefined}
              onClick={() => setActive(item)}
            >
              {item}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default Navbar
