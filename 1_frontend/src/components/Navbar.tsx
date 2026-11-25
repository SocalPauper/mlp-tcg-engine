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

  const statusLabel = user?.isVerified ? 'Verified ✓' : user?.isSafeMode ? 'Safe Mode 🔒' : 'Member';
  const statusColor = user?.isVerified ? '#34d399' : user?.isSafeMode ? '#fbbf24' : '#c084fc';

  const navItems = [
    { id: 'hub', label: '🏰 Main Hub' },
    { id: 'stable', label: '🐎 The Stable' },
    { id: 'collection', label: '📖 Binder' },
    { id: 'shop', label: '🛍️ Pony Shop' },
    { id: 'community', label: '🌟 Current Meta' },
    { id: 'standings', label: '🏆 Standings' },
    { id: 'fanPage', label: '🎨 Fan Page' },
    { id: 'rules', label: '📜 Rules' },
  ];

  return (
    <nav className="mlp-navbar">
      <div className="nav-brand" onClick={() => setCurrentTab('hub')}>
        <span className="nav-brand-crest">🦄✨</span>
        <span className="nav-brand-title">Equestria Clash</span>
      </div>

      <div className="nav-tabs-centered-beam">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-tab-btn ${currentTab === item.id ? 'active' : ''}`}
            onClick={() => setCurrentTab(item.id)}
          >
            {item.label}
          </button>
        ))}

        {isAdmin && (
          <button
            type="button"
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
              <span>🪙</span> {displayPoints} Pts
            </div>
            <div className="user-profile-widget">
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <span className="user-welcome">Hi, {user.displayName || user.username}</span>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 800,
                    color: statusColor,
                    marginTop: '1px',
                  }}
                >
                  {statusLabel}
                </span>
              </div>
              <button type="button" onClick={logout} className="auth-action-btn logout-btn">
                Logout
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={onOpenAuth} className="auth-action-btn login-cta">
            Login / Register
          </button>
        )}
      </div>
    </nav>
  );
}