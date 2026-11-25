import React, { useState } from 'react';
import { useAuth } from '../App';
import { API_BASE_URL } from '../config';
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

  // Global Bug Report Modal State
  const [showBugModal, setShowBugModal] = useState(false);
  const [bugCategory, setBugCategory] = useState('UI_UX');
  const [bugSummary, setBugSummary] = useState('');
  const [submittingBug, setSubmittingBug] = useState(false);

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

  const handleSubmitGlobalBug = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bugSummary.trim()) return;
    setSubmittingBug(true);
    try {
      const token = localStorage.getItem('token');
      const payload = {
        reporterName: user?.displayName || user?.username || 'Guest',
        category: bugCategory,
        summary: `[Tab: ${currentTab}] ${bugSummary.trim()}`,
        roomCode: null,
        seat: null,
        diagnosticClues: {
          capturedAt: new Date().toISOString(),
          activeTab: currentTab,
          url: window.location.href,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          userAgent: navigator.userAgent,
        },
      };

      let res = await fetch(`${API_BASE_URL}/api/bug-reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        res = await fetch(`${API_BASE_URL}/api/admin/bug-reports`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        alert('🐞 Thank you! Your bug report has been logged for review.');
        setBugSummary('');
        setShowBugModal(false);
      } else {
        alert('Unable to submit bug report right now. Please try again.');
      }
    } catch {
      alert('Network error submitting bug report.');
    } finally {
      setSubmittingBug(false);
    }
  };

  return (
    <>
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
          <button
            type="button"
            className="nav-bug-report-btn"
            onClick={() => setShowBugModal(true)}
            title="Report a bug or UI issue"
          >
            🐞 Report Bug
          </button>

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

      {showBugModal && (
        <div className="nav-bug-backdrop" onClick={() => setShowBugModal(false)}>
          <div className="nav-bug-modal" onClick={(e) => e.stopPropagation()}>
            <h3>🐞 Report a Bug</h3>
            <p>
              Spot a visual glitch, deck builder issue, shop bug, or card text typo? Send it straight to the dev queue!
            </p>
            <form onSubmit={handleSubmitGlobalBug} className="nav-bug-form">
              <label>
                Category:
                <select value={bugCategory} onChange={(e) => setBugCategory(e.target.value)}>
                  <option value="UI_UX">UI / Navigation / Display</option>
                  <option value="DECK_BUILDER">The Stable / Deck Builder</option>
                  <option value="SHOP_COLLECTION">Pony Shop / Binder</option>
                  <option value="DATABASE_CARDS">Card Text / Rarity / Art</option>
                  <option value="OTHER">Other Issue</option>
                </select>
              </label>

              <label>
                What happened?
                <textarea
                  rows={4}
                  required
                  placeholder="Describe the issue and what tab/card you were viewing..."
                  value={bugSummary}
                  onChange={(e) => setBugSummary(e.target.value)}
                />
              </label>

              <div className="nav-bug-actions">
                <button
                  type="button"
                  className="nav-bug-cancel-btn"
                  onClick={() => setShowBugModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="auth-action-btn" disabled={submittingBug}>
                  {submittingBug ? 'Sending...' : 'Submit Bug Report 🐞'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}