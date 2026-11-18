import React, { useState } from 'react';
import BackgroundUploader from './BackgroundUploader';
import './AdminPanel.css';

export default function AdminPanel() {
  const [announcement, setAnnouncement] = useState('');
  const [targetUser, setTargetUser] = useState('');
  const [selectedBgTab, setSelectedBgTab] = useState<string>('hub');
  
  // Opacity state for the selected tab background (default 1.0)
  const [opacity, setOpacity] = useState<number>(() => {
    const saved = localStorage.getItem(`bg_${selectedBgTab}_opacity`);
    return saved !== null ? parseFloat(saved) : 1.0;
  });

  const handleTabChange = (tab: string) => {
    setSelectedBgTab(tab);
    const saved = localStorage.getItem(`bg_${tab}_opacity`);
    setOpacity(saved !== null ? parseFloat(saved) : 1.0);
  };

  const handleOpacityChange = (val: number) => {
    setOpacity(val);
    localStorage.setItem(`bg_${selectedBgTab}_opacity`, val.toString());
  };

  const postAnnouncement = () => {
    alert(`Public Announcement Posted: "${announcement}"`);
    setAnnouncement('');
  };

  const handleModeration = (action: string) => {
    alert(`Action "${action}" successfully applied to user: ${targetUser}`);
    setTargetUser('');
  };

  return (
    <div className="admin-container" style={{ backgroundImage: `url(${localStorage.getItem('bg_admin') || ''})` }}>
      <h1>🛡️ Admin Control Panel</h1>

      <div className="admin-grid">
        {/* Theme & Tab Background Customizer with Opacity Slider */}
        <div className="panel-box">
          <h3>🎨 Tab Background & Opacity Manager</h3>
          <p style={{ fontSize: '13px', margin: 0, color: '#d8b4fe' }}>
            Upload background art and adjust backdrop opacity for any site tab.
          </p>
          <label style={{ fontSize: '12px', fontWeight: 800, color: '#fbcfe8', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            Target Tab:
            <select
              value={selectedBgTab}
              onChange={(e) => handleTabChange(e.target.value)}
            >
              <option value="hub">Main Hub (Landing Arena)</option>
              <option value="stable">The Stable (Deck Builder)</option>
              <option value="collection">Collection Binder</option>
              <option value="shop">Card Shop</option>
              <option value="admin">Admin Panel</option>
            </select>
          </label>

          <BackgroundUploader tabKey={selectedBgTab} />

          <label style={{ fontSize: '12px', fontWeight: 800, color: '#fbcfe8', display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
            Background Image Opacity: {Math.round(opacity * 100)}%
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={opacity}
              onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
              style={{ accentColor: '#ec4899', cursor: 'pointer' }}
            />
          </label>
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
          <h3>📢 Post Public Announcement</h3>
          <textarea
            rows={3}
            placeholder="Type announcement broadcast..."
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