import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../App';
import BackgroundUploader from './BackgroundUploader';
import './AdminPanel.css';

interface UserEntity {
  id: string;
  username: string;
  display_name: string;
  email: string;
  reward_points: number;
  is_verified: boolean;
  is_safe_mode: boolean;
}

interface CardEntity {
  id: string;
  name: string;
  rarity: string;
  card_type: string;
  element: string;
  image_url: string;
}

export default function AdminPanel() {
  const { user } = useAuth();
  const [announcement, setAnnouncement] = useState('');
  const [selectedBgTab, setSelectedBgTab] = useState<string>('hub');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [opacity, setOpacity] = useState<number>(1.0);
  const [savingOpacity, setSavingOpacity] = useState(false);

  // Collection Binder Cover Title state
  const [binderTitle, setBinderTitle] = useState<string>('Equestria Royal Archive');
  const [savingBinderTitle, setSavingBinderTitle] = useState(false);

  // User Management & Moderation States
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [usersList, setUsersList] = useState<UserEntity[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserEntity | null>(null);

  // Modal Action States
  const [activeModal, setActiveModal] = useState<'POINTS' | 'CARD' | null>(null);
  const [awardPointsInput, setAwardPointsInput] = useState('100');
  
  // Card Gifting States
  const [allCards, setAllCards] = useState<CardEntity[]>([]);
  const [cardSearchQuery, setCardSearchQuery] = useState('');
  const [selectedCardId, setSelectedCardId] = useState('');

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/media/settings`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.settings) {
          setSettings(data.settings);
          const initialOpacity = data.settings[`bg_${selectedBgTab}_opacity`];
          setOpacity(initialOpacity !== undefined ? parseFloat(initialOpacity) : 1.0);
          if (data.settings.binder_cover_title) {
            setBinderTitle(data.settings.binder_cover_title);
          }
        }
      })
      .catch((err) => console.error('Failed to load admin settings:', err));

    // Fetch user catalog & card catalog for admin actions
    fetchUsers('');
    fetchCards();
  }, []);

  const fetchUsers = async (query: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/users?search=${encodeURIComponent(query)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.success) {
        setUsersList(data.users || []);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  };

  const fetchCards = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cards`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setAllCards(data);
        if (data.length > 0) setSelectedCardId(data[0].id);
      }
    } catch (err) {
      console.error('Failed to load cards catalog:', err);
    }
  };

  const handleTabChange = (tab: string) => {
    setSelectedBgTab(tab);
    const saved = settings[`bg_${tab}_opacity`];
    setOpacity(saved !== undefined ? parseFloat(saved) : 1.0);
  };

  const handleSaveOpacity = async () => {
    setSavingOpacity(true);
    try {
      const key = `bg_${selectedBgTab}_opacity`;
      const res = await fetch(`${API_BASE_URL}/api/media/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          value: opacity.toString(),
          updatedBy: user?.username || 'admin',
        }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, [key]: opacity.toString() }));
        alert(`Global opacity (${Math.round(opacity * 100)}%) saved for all users!`);
      }
    } finally {
      setSavingOpacity(false);
    }
  };

  const handleSaveBinderTitle = async () => {
    const trimmed = binderTitle.trim() || 'Equestria Royal Archive';
    setSavingBinderTitle(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/media/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'binder_cover_title',
          value: trimmed,
          updatedBy: user?.username || 'admin',
        }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, binder_cover_title: trimmed }));
        setBinderTitle(trimmed);
        alert(`Global Collection Binder title updated to "${trimmed}"!`);
      }
    } finally {
      setSavingBinderTitle(false);
    }
  };

  const postAnnouncement = async () => {
    if (!announcement.trim()) return;
    await fetch(`${API_BASE_URL}/api/media/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'site_announcement',
        value: announcement.trim(),
        updatedBy: user?.username || 'admin',
      }),
    });
    alert(`Global Announcement Published: "${announcement}"`);
    setAnnouncement('');
  };

  // --- Admin Action 1: Award Pony Points ---
  const handleAwardPointsSubmit = async () => {
    if (!selectedUser) return;
    const pts = parseInt(awardPointsInput, 10);
    if (isNaN(pts)) return alert('Please enter a valid number of points.');

    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/users/award-points`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ userId: selectedUser.id, points: pts }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Successfully awarded ${pts} Pony Points to ${selectedUser.username}!`);
        setActiveModal(null);
        fetchUsers(userSearchQuery);
      } else {
        alert(data.error || 'Failed to award points.');
      }
    } catch (err) {
      console.error(err);
      alert('Error communicating with server.');
    }
  };

  // --- Admin Action 2: Gift Card ---
  const handleGiftCardSubmit = async () => {
    if (!selectedUser || !selectedCardId) return;

    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/users/gift-card`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ userId: selectedUser.id, cardId: selectedCardId }),
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || `Successfully gifted card to ${selectedUser.username}!`);
        setActiveModal(null);
      } else {
        alert(data.error || 'Failed to gift card.');
      }
    } catch (err) {
      console.error(err);
      alert('Error communicating with server.');
    }
  };

  // --- Admin Action 3: Silence, Suspend, Ban, or Active ---
  const handleModerationAction = async (actionType: 'SILENCE' | 'SUSPEND' | 'BAN' | 'ACTIVE') => {
    if (!selectedUser) return;
    if (!window.confirm(`Are you sure you want to apply action [${actionType}] to user ${selectedUser.username}?`)) {
      return;
    }

    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/users/moderate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ userId: selectedUser.id, action: actionType }),
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || `Action ${actionType} applied successfully.`);
        fetchUsers(userSearchQuery);
      } else {
        alert(data.error || 'Failed to apply moderation action.');
      }
    } catch (err) {
      console.error(err);
      alert('Error communicating with server.');
    }
  };

  const filteredCardsCatalog = allCards.filter(
    (c) =>
      c.name.toLowerCase().includes(cardSearchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(cardSearchQuery.toLowerCase())
  );

  const currentTabBgUrl = settings[`bg_${selectedBgTab}`] || '';
  const currentBinderCoverUrl = settings['bg_binder_cover'] || '';

  return (
    <div
      className="admin-container"
      style={settings['bg_admin'] ? { backgroundImage: `url(${settings['bg_admin']})` } : undefined}
    >
      <h1>🛡️ Admin Control Panel</h1>

      <div className="admin-grid">
        {/* User Management & Moderation Hub */}
        <div className="panel-box" style={{ gridColumn: '1 / -1' }}>
          <h3>👥 User Management, Points, Gifting &amp; Moderation</h3>
          <p style={{ fontSize: '13px', margin: 0, color: '#d8b4fe' }}>
            Search for registered users to award Pony Points, gift specific cards, or silence, suspend, and ban accounts.
          </p>

          <input
            type="text"
            placeholder="Search users by username, display name or email..."
            value={userSearchQuery}
            onChange={(e) => {
              setUserSearchQuery(e.target.value);
              fetchUsers(e.target.value);
            }}
            style={{ maxWidth: '420px', marginTop: '6px' }}
          />

          <div className="admin-user-table-wrapper">
            {usersList.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#c084fc' }}>No users found.</div>
            ) : (
              usersList.map((u) => (
                <div
                  key={u.id}
                  className="admin-user-row"
                  style={{
                    background: selectedUser?.id === u.id ? 'rgba(147, 51, 234, 0.35)' : 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedUser(u)}
                >
                  <div>
                    <strong>{u.username}</strong> ({u.display_name || 'No Display Name'})
                    <div style={{ fontSize: '11px', color: '#cbd5e1' }}>{u.email}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ color: '#fde047', fontWeight: 900 }}>🪙 {u.reward_points || 0} Pts</span>
                    <div style={{ fontSize: '10px', color: u.is_safe_mode ? '#fca5a5' : '#34d399' }}>
                      {u.is_safe_mode ? 'Restricted / Silenced' : 'Active'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {selectedUser && (
            <div style={{ background: 'rgba(24, 8, 38, 0.75)', border: '2px solid #ffd700', borderRadius: '12px', padding: '16px', marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <h4 style={{ margin: '0 0 4px 0', color: '#ffd700' }}>Selected User: {selectedUser.username}</h4>
                  <span style={{ fontSize: '12px', color: '#fbcfe8' }}>
                    Email: {selectedUser.email} • Balance: <strong>{selectedUser.reward_points || 0} Pony Points</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  style={{ background: 'transparent', border: '1px solid #f472b6', color: '#f472b6', padding: '4px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '11px' }}
                >
                  Deselect
                </button>
              </div>

              <div className="mod-buttons" style={{ marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setActiveModal('POINTS')}
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '10px', fontWeight: 900, cursor: 'pointer' }}
                >
                  🪙 Award Pony Points
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModal('CARD')}
                  style={{ background: 'linear-gradient(135deg, #ec4899, #9333ea)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '10px', fontWeight: 900, cursor: 'pointer' }}
                >
                  🎁 Gift Specific Card
                </button>
                <button
                  type="button"
                  onClick={() => handleModerationAction('SILENCE')}
                  style={{ background: '#ca8a04', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '10px', fontWeight: 900, cursor: 'pointer' }}
                >
                  🔇 Silence
                </button>
                <button
                  type="button"
                  onClick={() => handleModerationAction('SUSPEND')}
                  style={{ background: '#ea580c', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '10px', fontWeight: 900, cursor: 'pointer' }}
                >
                  ⏳ Suspend
                </button>
                <button
                  type="button"
                  onClick={() => handleModerationAction('BAN')}
                  style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '10px', fontWeight: 900, cursor: 'pointer' }}
                >
                  🚫 Ban User
                </button>
                <button
                  type="button"
                  onClick={() => handleModerationAction('ACTIVE')}
                  style={{ background: '#059669', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '10px', fontWeight: 900, cursor: 'pointer' }}
                >
                  ✅ Restore Active
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Global Theme & Tab Background Customizer */}
        <div className="panel-box">
          <h3>🎨 Global Tab Background & Opacity</h3>
          <p style={{ fontSize: '13px', margin: 0, color: '#d8b4fe' }}>
            Upload wallpapers to R2 and adjust background opacity globally for all visitors.
          </p>
          <label style={{ fontSize: '12px', fontWeight: 800, color: '#fbcfe8', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            Target Tab:
            <select value={selectedBgTab} onChange={(e) => handleTabChange(e.target.value)}>
              <option value="hub">Main Hub (Landing Arena)</option>
              <option value="stable">The Stable (Deck Builder)</option>
              <option value="collection">Collection Binder</option>
              <option value="shop">Card Shop</option>
              <option value="fanPage">Fan Art & Lore Page</option>
              <option value="admin">Admin Panel</option>
            </select>
          </label>

          <BackgroundUploader
            tabKey={selectedBgTab}
            currentUrl={currentTabBgUrl}
            onUploaded={(newUrl) =>
              setSettings((prev) => ({ ...prev, [`bg_${selectedBgTab}`]: newUrl }))
            }
          />

          {currentTabBgUrl && (
            <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid #9333ea', maxHeight: '110px' }}>
              <img
                src={currentTabBgUrl}
                alt="Active Wallpaper Preview"
                style={{ width: '100%', height: '110px', objectFit: 'cover', opacity }}
              />
            </div>
          )}

          <label style={{ fontSize: '12px', fontWeight: 800, color: '#fbcfe8', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            Global Wallpaper Opacity: {Math.round(opacity * 100)}%
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              style={{ accentColor: '#ec4899', cursor: 'pointer' }}
            />
          </label>
          <button
            type="button"
            onClick={handleSaveOpacity}
            disabled={savingOpacity}
            className="mlp-btn"
          >
            {savingOpacity ? 'Saving...' : 'Save Global Opacity'}
          </button>
        </div>

        {/* Collection Binder Cover Art & Name Customizer */}
        <div className="panel-box">
          <h3>📖 Collection Binder Cover &amp; Title</h3>
          <p style={{ fontSize: '13px', margin: 0, color: '#d8b4fe' }}>
            Customize the closed 3-ring binder front cover art and global album name for all players.
          </p>

          <label style={{ fontSize: '12px', fontWeight: 800, color: '#fbcfe8', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            Global Binder Title:
            <input
              type="text"
              placeholder="e.g., Equestria Royal Archive"
              value={binderTitle}
              onChange={(e) => setBinderTitle(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={handleSaveBinderTitle}
            disabled={savingBinderTitle}
            className="mlp-btn"
          >
            {savingBinderTitle ? 'Saving Title...' : 'Save Binder Title'}
          </button>

          <div style={{ marginTop: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#fbcfe8', display: 'block', marginBottom: '6px' }}>
              Binder Cover Artwork (R2 Upload):
            </span>
            <BackgroundUploader
              tabKey="binder_cover"
              currentUrl={currentBinderCoverUrl}
              onUploaded={(newUrl) =>
                setSettings((prev) => ({ ...prev, bg_binder_cover: newUrl }))
              }
            />
          </div>

          {currentBinderCoverUrl && (
            <div style={{ borderRadius: '10px', overflow: 'hidden', border: '2px solid #ffd700', maxHeight: '140px' }}>
              <img
                src={currentBinderCoverUrl}
                alt="Binder Cover Preview"
                style={{ width: '100%', height: '140px', objectFit: 'cover' }}
              />
            </div>
          )}
        </div>

        {/* Statistics */}
        <div className="panel-box">
          <h3>📊 Website Statistics</h3>
          <p>Total Visits: <strong>14,289</strong></p>
          <p>Active Games Created: <strong>342</strong></p>
          <p>Registered Users: <strong>1,204</strong></p>
        </div>

        {/* Public Announcements */}
        <div className="panel-box">
          <h3>📢 Post Global Announcement</h3>
          <textarea
            rows={3}
            placeholder="Type announcement broadcast for all users..."
            value={announcement}
            onChange={(e) => setAnnouncement(e.target.value)}
          />
          <button onClick={postAnnouncement} className="mlp-btn">Publish Announcement</button>
        </div>

        {/* Content Auditing */}
        <div className="panel-box">
          <h3>🔍 Audit Decks & Content</h3>
          <p>Review user-submitted deck lists for policy compliance and ban flagged card combinations.</p>
          <button className="mlp-btn">Audit Database Decks</button>
        </div>
      </div>

      {/* MODAL 1: AWARD PONY POINTS */}
      {activeModal === 'POINTS' && selectedUser && (
        <div className="admin-modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, color: '#ffd700' }}>🪙 Award Pony Points</h3>
            <p style={{ fontSize: '13px', margin: 0, color: '#fbcfe8' }}>
              Grant Pony Points to user <strong>{selectedUser.username}</strong>:
            </p>
            <input
              type="number"
              placeholder="Enter number of points..."
              value={awardPointsInput}
              onChange={(e) => setAwardPointsInput(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                style={{ background: 'transparent', border: '1px solid #c084fc', color: '#c084fc', padding: '8px 16px', borderRadius: '10px', cursor: 'pointer', fontWeight: 800 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAwardPointsSubmit}
                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 900 }}
              >
                Submit &amp; Award
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: GIFT SPECIFIC CARD */}
      {activeModal === 'CARD' && selectedUser && (
        <div className="admin-modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, color: '#ffd700' }}>🎁 Gift Specific Card</h3>
            <p style={{ fontSize: '13px', margin: 0, color: '#fbcfe8' }}>
              Select a card to gift directly to <strong>{selectedUser.username}</strong>&apos;s collection:
            </p>

            <input
              type="text"
              placeholder="Search cards by name or ID..."
              value={cardSearchQuery}
              onChange={(e) => setCardSearchQuery(e.target.value)}
            />

            <select
              value={selectedCardId}
              onChange={(e) => setSelectedCardId(e.target.value)}
              style={{ maxHeight: '160px' }}
            >
              {filteredCardsCatalog.map((c) => (
                <option key={c.id} value={c.id}>
                  [{c.id}] {c.name} ({c.rarity} - {c.card_type})
                </option>
              ))}
            </select>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                style={{ background: 'transparent', border: '1px solid #c084fc', color: '#c084fc', padding: '8px 16px', borderRadius: '10px', cursor: 'pointer', fontWeight: 800 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGiftCardSubmit}
                style={{ background: 'linear-gradient(135deg, #ec4899, #9333ea)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 900 }}
              >
                Gift Card 🎁
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}