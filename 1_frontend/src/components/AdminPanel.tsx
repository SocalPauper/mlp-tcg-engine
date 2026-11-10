import React, { useState } from 'react';
import BackgroundUploader from './BackgroundUploader';
import './AdminPanel.css';

export default function AdminPanel() {
  const [announcement, setAnnouncement] = useState('');
  const [targetUser, setTargetUser] = useState('');

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
      <BackgroundUploader tabKey="admin" />
      
      <h1>🛡️ Admin Control Panel</h1>
      
      <div className="admin-grid">
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
            onChange={e => setAnnouncement(e.target.value)}
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
            onChange={e => setTargetUser(e.target.value)} 
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