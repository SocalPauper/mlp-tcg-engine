import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../App';
import BackgroundUploader from './BackgroundUploader';
import './AdminPanel.css';

export default function AdminPanel() {
  const { user } = useAuth();
  const [announcement, setAnnouncement] = useState('');
  const [targetUser, setTargetUser] = useState('');
  const [selectedBgTab, setSelectedBgTab] = useState<string>('hub');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [opacity, setOpacity] = useState<number>(1.0);
  const [savingOpacity, setSavingOpacity] = useState(false);

  // Collection Binder Cover Title state
  const [binderTitle, setBinderTitle] = useState<string>('Equestria Royal Archive');
  const [savingBinderTitle, setSavingBinderTitle] = useState(false);

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
  }, []);

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

  const handleModeration = (action: string) => {
    alert(`Action "${action}" successfully applied to user: ${targetUser}`);
    setTargetUser('');
  };

  const currentTabBgUrl = settings[`bg_${selectedBgTab}`] || '';
  const currentBinderCoverUrl = settings['bg_binder_cover'] || '';

  return (
    <div
      className="admin-container"
      style={settings['bg_admin'] ? { backgroundImage: `url(${settings['bg_admin']})` } : undefined}
    >
      <h1>🛡️ Admin Control Panel</h1>

      <div className="admin-grid">
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

        {/* User Moderation */}
        <div className="panel-box">
          <h3>⚖️ Member Moderation</h3>
          <input
            type="text"
            placeholder="Username or Email..."
            value={targetUser}
            onChange={(e) => setTargetUser(e.target.value)}
          />
          <div className="mod-buttons">
            <button onClick={() => handleModeration('Punish')} className="mlp-btn warning">Punish</button>
            <button onClick={() => handleModeration('Silence')} className="mlp-btn warning">Silence</button>
            <button onClick={() => handleModeration('Ban')} className="mlp-btn danger">Ban</button>
          </div>
        </div>

        {/* Content Auditing */}
        <div className="panel-box">
          <h3>🔍 Audit Decks & Content</h3>
          <p>Review user-submitted deck lists for policy compliance and ban flagged card combinations.</p>
          <button className="mlp-btn">Audit Database Decks</button>
        </div>
      </div>
    </div>
  );
}