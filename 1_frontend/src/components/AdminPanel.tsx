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

interface BugComment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

interface BugReportItem {
  id: number;
  reporter_name: string;
  category: string;
  room_code: string | null;
  seat: string | null;
  summary: string;
  board_snapshot: any;
  diagnostic_clues: any;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  admin_notes: BugComment[];
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  created_at: string;
  updated_at?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#38bdf8',
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: '#f43f5e',
  IN_PROGRESS: '#f59e0b',
  RESOLVED: '#10b981',
};

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

  // Bug Reports & Triage States
  const [bugReports, setBugReports] = useState<BugReportItem[]>([]);
  const [loadingBugs, setLoadingBugs] = useState(false);
  const [bugStatusFilter, setBugStatusFilter] = useState<string>('ALL');
  const [bugPriorityFilter, setBugPriorityFilter] = useState<string>('ALL');
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});
  const [inspectedBug, setInspectedBug] = useState<BugReportItem | null>(null);

  // Manual Bug Creation Form States
  const [showNewBugForm, setShowNewBugForm] = useState(false);
  const [newBugSummary, setNewBugSummary] = useState('');
  const [newBugCategory, setNewBugCategory] = useState('ENGINE_RULES');
  const [newBugPriority, setNewBugPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>(
    'HIGH'
  );
  const [newBugRoomCode, setNewBugRoomCode] = useState('');
  const [newBugNote, setNewBugNote] = useState('');

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

    fetchUsers('');
    fetchCards();
    fetchBugReports();
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

  const fetchBugReports = async () => {
    setLoadingBugs(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/api/admin/bug-reports`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.reports)) {
        setBugReports(data.reports);
      }
    } catch (err) {
      console.error('Failed to fetch bug reports:', err);
    } finally {
      setLoadingBugs(false);
    }
  };

  const handleUpdateBug = async (
    id: number,
    updates: { status?: string; priority?: string; newComment?: string }
  ) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/api/admin/bug-reports/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.success && data.report) {
        setBugReports((prev) => prev.map((r) => (r.id === id ? data.report : r)));
        if (updates.newComment) {
          setCommentDrafts((prev) => ({ ...prev, [id]: '' }));
        }
        if (inspectedBug?.id === id) {
          setInspectedBug(data.report);
        }
      }
    } catch (err) {
      console.error('Failed to update bug report:', err);
    }
  };

  const handleCreateManualBug = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBugSummary.trim()) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/api/admin/bug-reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          summary: newBugSummary.trim(),
          category: newBugCategory,
          priority: newBugPriority,
          roomCode: newBugRoomCode.trim() || null,
          initialNote: newBugNote.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.success && data.report) {
        setBugReports((prev) => [data.report, ...prev]);
        setNewBugSummary('');
        setNewBugRoomCode('');
        setNewBugNote('');
        setShowNewBugForm(false);
      }
    } catch (err) {
      console.error('Failed to create manual bug:', err);
    }
  };

  const handleDeleteBug = async (id: number) => {
    if (!window.confirm(`Permanently delete Bug Report #${id}?`)) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/api/admin/bug-reports/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.success) {
        setBugReports((prev) => prev.filter((r) => r.id !== id));
        if (inspectedBug?.id === id) setInspectedBug(null);
      }
    } catch (err) {
      console.error('Failed to delete bug report:', err);
    }
  };

  const handleDownloadBugJson = (report: BugReportItem) => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bug-report-${report.id}${report.room_code ? `-${report.room_code}` : ''}.json`;
    a.click();
    URL.revokeObjectURL(url);
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

  const handleModerationAction = async (actionType: 'SILENCE' | 'SUSPEND' | 'BAN' | 'ACTIVE') => {
    if (!selectedUser) return;
    if (
      !window.confirm(
        `Are you sure you want to apply action [${actionType}] to user ${selectedUser.username}?`
      )
    ) {
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

  const filteredBugs = bugReports.filter((b) => {
    const statusOk = bugStatusFilter === 'ALL' || b.status === bugStatusFilter;
    const priorityOk = bugPriorityFilter === 'ALL' || (b.priority || 'MEDIUM') === bugPriorityFilter;
    return statusOk && priorityOk;
  });

  const currentTabBgUrl = settings[`bg_${selectedBgTab}`] || '';
  const currentBinderCoverUrl = settings['bg_binder_cover'] || '';

  return (
    <div
      className="admin-container"
      style={settings['bg_admin'] ? { backgroundImage: `url(${settings['bg_admin']})` } : undefined}
    >
      <h1>🛡️ Admin Control Panel</h1>

      <div className="admin-grid">
        {/* ================================================================= */}
        {/* ALPHA BUG REPORTS, DIAGNOSTIC CLUES & PROGRESS TRACKER            */}
        {/* ================================================================= */}
        <div className="panel-box" style={{ gridColumn: '1 / -1' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div>
              <h3 style={{ margin: '0 0 4px 0' }}>
                🐞 Alpha Bug Reports &amp; Progress Tracker ({filteredBugs.length})
              </h3>
              <p style={{ fontSize: '13px', margin: 0, color: '#d8b4fe' }}>
                Triage player bug reports, inspect auto-captured engine clues, set priority, and log progress notes.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setShowNewBugForm((prev) => !prev)}
                style={{
                  background: 'linear-gradient(135deg, #ec4899, #9333ea)',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 14px',
                  borderRadius: '10px',
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                {showNewBugForm ? '✕ Close Form' : '+ Log New Bug'}
              </button>
              <button
                type="button"
                onClick={fetchBugReports}
                disabled={loadingBugs}
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  border: '1px solid #c084fc',
                  color: '#fde047',
                  padding: '8px 14px',
                  borderRadius: '10px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {loadingBugs ? 'Refreshing...' : '🔄 Refresh'}
              </button>
            </div>
          </div>

          {/* Manual Bug Creation Form */}
          {showNewBugForm && (
            <form
              onSubmit={handleCreateManualBug}
              style={{
                background: 'rgba(24, 8, 38, 0.85)',
                border: '2px solid #f472b6',
                borderRadius: '12px',
                padding: '14px',
                marginTop: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <strong style={{ color: '#fde047', fontSize: '14px' }}>
                ➕ Add New Bug / Alpha Task
              </strong>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <select
                  value={newBugCategory}
                  onChange={(e) => setNewBugCategory(e.target.value)}
                  style={{ maxWidth: '200px' }}
                >
                  <option value="ENGINE_RULES">Engine / Card Rules</option>
                  <option value="IN_MATCH_GAMEPLAY">In-Match Gameplay</option>
                  <option value="UI_UX">UI / UX Polish</option>
                  <option value="DATABASE_CARDS">Database / Card Data</option>
                </select>
                <select
                  value={newBugPriority}
                  onChange={(e) => setNewBugPriority(e.target.value as any)}
                  style={{ maxWidth: '170px' }}
                >
                  <option value="CRITICAL">🔴 Critical</option>
                  <option value="HIGH">🟠 High</option>
                  <option value="MEDIUM">🟡 Medium</option>
                  <option value="LOW">🔵 Low</option>
                </select>
                <input
                  type="text"
                  placeholder="Room code or Card ID (optional)"
                  value={newBugRoomCode}
                  onChange={(e) => setNewBugRoomCode(e.target.value)}
                  style={{ maxWidth: '220px' }}
                />
              </div>
              <textarea
                rows={2}
                required
                placeholder="Describe the bug or expected behavior..."
                value={newBugSummary}
                onChange={(e) => setNewBugSummary(e.target.value)}
              />
              <input
                type="text"
                placeholder="Initial progress comment / reproduction note (optional)..."
                value={newBugNote}
                onChange={(e) => setNewBugNote(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="submit" className="mlp-btn">
                  Save Bug Entry 💾
                </button>
              </div>
            </form>
          )}

          {/* Filter Bar */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
            <select
              value={bugStatusFilter}
              onChange={(e) => setBugStatusFilter(e.target.value)}
              style={{ maxWidth: '180px' }}
            >
              <option value="ALL">All Statuses</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="RESOLVED">Resolved</option>
            </select>

            <select
              value={bugPriorityFilter}
              onChange={(e) => setBugPriorityFilter(e.target.value)}
              style={{ maxWidth: '180px' }}
            >
              <option value="ALL">All Priorities</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>

          {/* Bug List */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              marginTop: '10px',
              maxHeight: '540px',
              overflowY: 'auto',
              paddingRight: '4px',
            }}
          >
            {filteredBugs.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#c084fc' }}>
                No bug reports match the selected filters.
              </div>
            ) : (
              filteredBugs.map((bug) => {
                const prio = bug.priority || 'MEDIUM';
                const notes = Array.isArray(bug.admin_notes) ? bug.admin_notes : [];
                const anomalies: string[] = bug.diagnostic_clues?.flaggedAnomalies || [];

                return (
                  <div
                    key={bug.id}
                    style={{
                      background: 'rgba(18, 6, 30, 0.85)',
                      border: `1.5px solid ${PRIORITY_COLORS[prio] || '#a855f7'}`,
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    {/* Header Row */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                        gap: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <strong style={{ color: '#fde047', fontSize: '15px' }}>#{bug.id}</strong>
                          <span
                            style={{
                              background: PRIORITY_COLORS[prio] || '#eab308',
                              color: '#111827',
                              fontWeight: 900,
                              fontSize: '10.5px',
                              padding: '2px 8px',
                              borderRadius: '999px',
                            }}
                          >
                            {prio}
                          </span>
                          <span
                            style={{
                              background: STATUS_COLORS[bug.status] || '#f43f5e',
                              color: '#fff',
                              fontWeight: 900,
                              fontSize: '10.5px',
                              padding: '2px 8px',
                              borderRadius: '999px',
                            }}
                          >
                            {bug.status}
                          </span>
                          <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
                            by <strong>{bug.reporter_name}</strong> • {bug.category}
                            {bug.room_code ? ` • Room: ${bug.room_code}` : ''}
                            {bug.seat ? ` (Seat ${bug.seat})` : ''}
                          </span>
                        </div>
                        <div style={{ fontSize: '14px', color: '#fff', fontWeight: 700 }}>
                          {bug.summary}
                        </div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                          Reported: {new Date(bug.created_at).toLocaleString()}
                        </div>
                      </div>

                      {/* Controls */}
                      <div
                        style={{
                          display: 'flex',
                          gap: '6px',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        <select
                          value={prio}
                          onChange={(e) => handleUpdateBug(bug.id, { priority: e.target.value })}
                          title="Set Priority"
                          style={{ padding: '4px 8px', fontSize: '11.5px' }}
                        >
                          <option value="CRITICAL">Critical</option>
                          <option value="HIGH">High</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="LOW">Low</option>
                        </select>

                        <select
                          value={bug.status}
                          onChange={(e) => handleUpdateBug(bug.id, { status: e.target.value })}
                          title="Set Status"
                          style={{ padding: '4px 8px', fontSize: '11.5px' }}
                        >
                          <option value="OPEN">OPEN</option>
                          <option value="IN_PROGRESS">IN_PROGRESS</option>
                          <option value="RESOLVED">RESOLVED</option>
                        </select>

                        {(bug.diagnostic_clues || bug.board_snapshot) && (
                          <button
                            type="button"
                            onClick={() => setInspectedBug(bug)}
                            style={{
                              background: '#0284c7',
                              color: '#fff',
                              border: 'none',
                              padding: '5px 10px',
                              borderRadius: '8px',
                              fontSize: '11.5px',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            🔍 Clues &amp; Snapshot
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleDownloadBugJson(bug)}
                          style={{
                            background: 'rgba(255,255,255,0.12)',
                            color: '#fde047',
                            border: '1px solid rgba(253,224,71,0.4)',
                            padding: '5px 9px',
                            borderRadius: '8px',
                            fontSize: '11.5px',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                          title="Download JSON"
                        >
                          📥 JSON
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteBug(bug.id)}
                          style={{
                            background: '#dc2626',
                            color: '#fff',
                            border: 'none',
                            padding: '5px 9px',
                            borderRadius: '8px',
                            fontSize: '11.5px',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                          title="Delete Bug Report"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {/* Auto-Detected Engine Clues Preview */}
                    {anomalies.length > 0 && (
                      <div
                        style={{
                          background: 'rgba(244, 63, 94, 0.14)',
                          border: '1px solid rgba(244, 63, 94, 0.45)',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          fontSize: '11.5px',
                          color: '#fecdd3',
                        }}
                      >
                        <strong style={{ color: '#fda4af' }}>
                          ⚠️ Auto-Detected Engine Clues:
                        </strong>
                        <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                          {anomalies.slice(-3).map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Progress Comments Thread */}
                    {notes.length > 0 && (
                      <div
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <span style={{ fontSize: '11px', fontWeight: 900, color: '#fde047' }}>
                          💬 Progress Notes ({notes.length}):
                        </span>
                        {notes.map((n) => (
                          <div
                            key={n.id}
                            style={{
                              fontSize: '12px',
                              color: '#e2e8f0',
                              borderLeft: '2px solid #38bdf8',
                              paddingLeft: '8px',
                            }}
                          >
                            <strong style={{ color: '#7dd3fc' }}>{n.author}</strong>{' '}
                            <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                              ({new Date(n.createdAt).toLocaleString()})
                            </span>
                            : {n.text}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add Progress Comment Input */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        placeholder="Add progress comment or fix note..."
                        value={commentDrafts[bug.id] || ''}
                        onChange={(e) =>
                          setCommentDrafts((prev) => ({ ...prev, [bug.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (commentDrafts[bug.id] || '').trim()) {
                            e.preventDefault();
                            handleUpdateBug(bug.id, { newComment: commentDrafts[bug.id] });
                          }
                        }}
                        style={{ flex: 1, fontSize: '12px', padding: '6px 10px' }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if ((commentDrafts[bug.id] || '').trim()) {
                            handleUpdateBug(bug.id, { newComment: commentDrafts[bug.id] });
                          }
                        }}
                        style={{
                          background: 'linear-gradient(135deg, #10b981, #059669)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '6px 12px',
                          fontSize: '12px',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        + Comment
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

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
              <div style={{ padding: '20px', textAlign: 'center', color: '#c084fc' }}>
                No users found.
              </div>
            ) : (
              usersList.map((u) => (
                <div
                  key={u.id}
                  className="admin-user-row"
                  style={{
                    background:
                      selectedUser?.id === u.id ? 'rgba(147, 51, 234, 0.35)' : 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedUser(u)}
                >
                  <div>
                    <strong>{u.username}</strong> ({u.display_name || 'No Display Name'})
                    <div style={{ fontSize: '11px', color: '#cbd5e1' }}>{u.email}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ color: '#fde047', fontWeight: 900 }}>
                      🪙 {u.reward_points || 0} Pts
                    </span>
                    <div
                      style={{
                        fontSize: '10px',
                        color: u.is_safe_mode ? '#fca5a5' : '#34d399',
                      }}
                    >
                      {u.is_safe_mode ? 'Restricted / Silenced' : 'Active'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {selectedUser && (
            <div
              style={{
                background: 'rgba(24, 8, 38, 0.75)',
                border: '2px solid #ffd700',
                borderRadius: '12px',
                padding: '16px',
                marginTop: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div>
                  <h4 style={{ margin: '0 0 4px 0', color: '#ffd700' }}>
                    Selected User: {selectedUser.username}
                  </h4>
                  <span style={{ fontSize: '12px', color: '#fbcfe8' }}>
                    Email: {selectedUser.email} • Balance:{' '}
                    <strong>{selectedUser.reward_points || 0} Pony Points</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  style={{
                    background: 'transparent',
                    border: '1px solid #f472b6',
                    color: '#f472b6',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  Deselect
                </button>
              </div>

              <div className="mod-buttons" style={{ marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setActiveModal('POINTS')}
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '10px',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  🪙 Award Pony Points
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModal('CARD')}
                  style={{
                    background: 'linear-gradient(135deg, #ec4899, #9333ea)',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '10px',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  🎁 Gift Specific Card
                </button>
                <button
                  type="button"
                  onClick={() => handleModerationAction('SILENCE')}
                  style={{
                    background: '#ca8a04',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  🔇 Silence
                </button>
                <button
                  type="button"
                  onClick={() => handleModerationAction('SUSPEND')}
                  style={{
                    background: '#ea580c',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  ⏳ Suspend
                </button>
                <button
                  type="button"
                  onClick={() => handleModerationAction('BAN')}
                  style={{
                    background: '#dc2626',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  🚫 Ban User
                </button>
                <button
                  type="button"
                  onClick={() => handleModerationAction('ACTIVE')}
                  style={{
                    background: '#059669',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  ✅ Restore Active
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Global Theme & Tab Background Customizer */}
        <div className="panel-box">
          <h3>🎨 Global Tab Background &amp; Opacity</h3>
          <p style={{ fontSize: '13px', margin: 0, color: '#d8b4fe' }}>
            Upload wallpapers to R2 and adjust background opacity globally for all visitors.
          </p>
          <label
            style={{
              fontSize: '12px',
              fontWeight: 800,
              color: '#fbcfe8',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            Target Tab:
            <select value={selectedBgTab} onChange={(e) => handleTabChange(e.target.value)}>
              <option value="hub">Main Hub (Landing Arena)</option>
              <option value="stable">The Stable (Deck Builder)</option>
              <option value="collection">Collection Binder</option>
              <option value="shop">Card Shop</option>
              <option value="fanPage">Fan Art &amp; Lore Page</option>
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
            <div
              style={{
                borderRadius: '10px',
                overflow: 'hidden',
                border: '1px solid #9333ea',
                maxHeight: '110px',
              }}
            >
              <img
                src={currentTabBgUrl}
                alt="Active Wallpaper Preview"
                style={{ width: '100%', height: '110px', objectFit: 'cover', opacity }}
              />
            </div>
          )}

          <label
            style={{
              fontSize: '12px',
              fontWeight: 800,
              color: '#fbcfe8',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
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

          <label
            style={{
              fontSize: '12px',
              fontWeight: 800,
              color: '#fbcfe8',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
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
            <span
              style={{
                fontSize: '12px',
                fontWeight: 800,
                color: '#fbcfe8',
                display: 'block',
                marginBottom: '6px',
              }}
            >
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
            <div
              style={{
                borderRadius: '10px',
                overflow: 'hidden',
                border: '2px solid #ffd700',
                maxHeight: '140px',
              }}
            >
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
          <p>
            Total Visits: <strong>14,289</strong>
          </p>
          <p>
            Active Games Created: <strong>342</strong>
          </p>
          <p>
            Registered Users: <strong>1,204</strong>
          </p>
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
          <button onClick={postAnnouncement} className="mlp-btn">
            Publish Announcement
          </button>
        </div>

        {/* Content Auditing */}
        <div className="panel-box">
          <h3>🔍 Audit Decks &amp; Content</h3>
          <p>
            Review user-submitted deck lists for policy compliance and ban flagged card combinations.
          </p>
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
                style={{
                  background: 'transparent',
                  border: '1px solid #c084fc',
                  color: '#c084fc',
                  padding: '8px 16px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontWeight: 800,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAwardPointsSubmit}
                style={{
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 20px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontWeight: 900,
                }}
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
                style={{
                  background: 'transparent',
                  border: '1px solid #c084fc',
                  color: '#c084fc',
                  padding: '8px 16px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontWeight: 800,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGiftCardSubmit}
                style={{
                  background: 'linear-gradient(135deg, #ec4899, #9333ea)',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 20px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontWeight: 900,
                }}
              >
                Gift Card 🎁
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: DIAGNOSTIC CLUES & BOARD SNAPSHOT INSPECTOR */}
      {inspectedBug && (
        <div className="admin-modal-backdrop" onClick={() => setInspectedBug(null)}>
          <div
            className="admin-modal-box"
            style={{ maxWidth: '820px', width: '94vw', maxHeight: '85dvh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#fde047' }}>
                🔍 Diagnostic Clues — Bug #{inspectedBug.id}
              </h3>
              <button
                type="button"
                onClick={() => setInspectedBug(null)}
                style={{
                  background: 'transparent',
                  border: '1px solid #f472b6',
                  color: '#f472b6',
                  borderRadius: '8px',
                  padding: '4px 10px',
                  cursor: 'pointer',
                }}
              >
                ✕ Close
              </button>
            </div>

            <p style={{ margin: 0, fontSize: '13.5px', color: '#fff' }}>
              <strong>Summary:</strong> {inspectedBug.summary}
            </p>

            {inspectedBug.diagnostic_clues && (
              <>
                <strong style={{ color: '#38bdf8', fontSize: '12.5px' }}>
                  Structured Diagnostic Clues:
                </strong>
                <pre
                  style={{
                    background: '#090410',
                    color: '#e2e8f0',
                    padding: '12px',
                    borderRadius: '10px',
                    fontSize: '11.5px',
                    maxHeight: '240px',
                    overflow: 'auto',
                    margin: 0,
                  }}
                >
                  {JSON.stringify(inspectedBug.diagnostic_clues, null, 2)}
                </pre>
              </>
            )}

            {inspectedBug.board_snapshot && (
              <>
                <strong style={{ color: '#f472b6', fontSize: '12.5px' }}>
                  Full Board Snapshot &amp; Debug Trace:
                </strong>
                <pre
                  style={{
                    background: '#090410',
                    color: '#cbd5e1',
                    padding: '12px',
                    borderRadius: '10px',
                    fontSize: '11px',
                    maxHeight: '240px',
                    overflow: 'auto',
                    margin: 0,
                  }}
                >
                  {JSON.stringify(inspectedBug.board_snapshot, null, 2)}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}