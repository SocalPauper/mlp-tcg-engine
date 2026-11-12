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
  
  // Check if user has administrator privileges
  const isAdmin = user && (user.role === 'admin' || user.isSafeMode === false);

  return (
    <nav className="mlp-navbar">
      <div className="nav-brand" onClick={() => setCurrentTab('hub')}>
        ✨ Equestria Clash
      </div>

      <div className="nav-tabs-rainbow-arc">
        <button 
          className={`nav-tab-btn tab-magic ${currentTab === 'hub' ? 'active' : ''}`}
          onClick={() => setCurrentTab('hub')}
        >
          Main Hub
        </button>
        {/* CHANGED: Deck Builder is now The Stable */}
        <button 
          className={`nav-tab-btn tab-honesty ${currentTab === 'stable' ? 'active' : ''}`}
          onClick={() => setCurrentTab('stable')}
        >
          The Stable
        </button>
        <button 
          className={`nav-tab-btn tab-kindness ${currentTab === 'community' ? 'active' : ''}`}
          onClick={() => setCurrentTab('community')}
        >
          Community
        </button>
        <button 
          className={`nav-tab-btn tab-laughter ${currentTab === 'standings' ? 'active' : ''}`}
          onClick={() => setCurrentTab('standings')}
        >
          Standings
        </button>
        <button 
          className={`nav-tab-btn tab-loyalty ${currentTab === 'fanPage' ? 'active' : ''}`}
          onClick={() => setCurrentTab('fanPage')}
        >
          Fan Page
        </button>
        
        {isAdmin && (
          <button 
            className={`nav-tab-btn tab-admin ${currentTab === 'admin' ? 'active' : ''}`}
            onClick={() => setCurrentTab('admin')}
          >
            🛡️ Admin
          </button>
        )}
      </div>

      <div className="nav-auth-container">
        {user ? (
          <div className="user-profile-widget">
            <span className="user-welcome">Hi, {user.displayName || user.username}</span>
            <button onClick={logout} className="auth-action-btn logout-btn">Logout</button>
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