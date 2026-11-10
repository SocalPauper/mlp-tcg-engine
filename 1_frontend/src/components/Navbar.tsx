import React from 'react';
import { useAuth } from '../App';
import './Navbar.css';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  onOpenAuth: () => void;
}

export default function Navbar({ currentTab, setCurrentTab, onOpenAuth }: NavbarProps) {
  const { user, logout } = useAuth();

  return (
    <nav className="mlp-navbar">
      <div className="nav-brand" onClick={() => setCurrentTab('hub')}>
        ✨ Equestria Clash TCG
      </div>

      <div className="nav-tabs">
        <button 
          className={`nav-btn ${currentTab === 'hub' ? 'active' : ''}`}
          onClick={() => setCurrentTab('hub')}
        >
          Main Hub
        </button>
        <button 
          className={`nav-btn ${currentTab === 'deckBuilder' ? 'active' : ''}`}
          onClick={() => setCurrentTab('deckBuilder')}
        >
          Deck Builder
        </button>
        <button 
          className={`nav-btn ${currentTab === 'community' ? 'active' : ''}`}
          onClick={() => setCurrentTab('community')}
        >
          Community Decks
        </button>
        <button 
          className={`nav-btn ${currentTab === 'standings' ? 'active' : ''}`}
          onClick={() => setCurrentTab('standings')}
        >
          Standings
        </button>
        <button 
          className={`nav-btn ${currentTab === 'fanPage' ? 'active' : ''}`}
          onClick={() => setCurrentTab('fanPage')}
        >
          Fan Page
        </button>
        {user && user.isSafeMode === false /* Or admin flag */ && (
          <button 
            className={`nav-btn admin-badge ${currentTab === 'admin' ? 'active' : ''}`}
            onClick={() => setCurrentTab('admin')}
          >
            🛡️ Admin
          </button>
        )}
      </div>

      <div className="nav-auth">
        {user ? (
          <div className="user-profile-widget">
            <span>Hi, {user.displayName || user.username}</span>
            <button onClick={logout} className="auth-action-btn">Logout</button>
          </div>
        ) : (
          <button onClick={onOpenAuth} className="auth-action-btn login-cta">
            Login / Register
          </button>
        )}
      </div>
    </nav>
  );
}