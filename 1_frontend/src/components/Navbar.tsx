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
  
  const isAdmin = user && (user.role === 'admin' || user.isSafeMode === false);
  const displayPoints = user?.reward_points !== undefined ? user.reward_points : 500;
  
  // Status determination
  const statusLabel = user?.isVerified ? 'Verified ✓' : user?.isSafeMode ? 'Safe Mode 🔒' : 'Member';
  const statusColor = user?.isVerified ? '#34d399' : user?.isSafeMode ? '#fbbf24' : '#a855f7';

  return (
    <nav className="mlp-navbar" style={{ position: 'sticky', top: 0, zIndex: 1000 }}>
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
        <button 
          className={`nav-tab-btn tab-honesty ${currentTab === 'stable' ? 'active' : ''}`}
          onClick={() => setCurrentTab('stable')}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: '1.2', padding: '6px 16px' }}
        >
          <span>The Stable</span>
          <span style={{ fontSize: '10px', opacity: 0.85, fontWeight: 700 }}>(Decks)</span>
        </button>
        <button 
          className={`nav-tab-btn tab-laughter ${currentTab === 'shop' ? 'active' : ''}`}
          onClick={() => setCurrentTab('shop')}
        >
          🛍️ Shop
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
          <div className="user-profile-group">
            <div className="points-badge" title="Pony Points">
              <span>⭐</span> {displayPoints} Pony Points
            </div>
            <div className="user-profile-widget">
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <span className="user-welcome">Hi, {user.displayName || user.username}</span>
                <span style={{ fontSize: '10px', fontWeight: 800, color: statusColor, background: 'rgba(0,0,0,0.15)', padding: '1px 6px', borderRadius: '6px', marginTop: '2px' }}>
                  {statusLabel}
                </span>
              </div>
              <button onClick={logout} className="auth-action-btn logout-btn">Logout</button>
            </div>
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