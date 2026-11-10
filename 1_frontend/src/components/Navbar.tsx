import React from 'react';
import './Navbar.css';

interface NavbarProps {
  currentView: 'home' | 'deckBuilder';
  setCurrentView: (view: 'home' | 'deckBuilder') => void;
}

export default function Navbar({ currentView, setCurrentView }: NavbarProps) {
  return (
    <nav className="app-navbar">
      <div className="nav-brand" onClick={() => setCurrentView('home')}>
        Equestria Clash TCG Online
      </div>
      <div className="nav-links">
        <button 
          className={`nav-link-btn ${currentView === 'home' ? 'active' : ''}`}
          onClick={() => setCurrentView('home')}
        >
          Home
        </button>
        <button 
          className={`nav-link-btn ${currentView === 'deckBuilder' ? 'active' : ''}`}
          onClick={() => setCurrentView('deckBuilder')}
        >
          Deck Builder
        </button>
      </div>
    </nav>
  );
}