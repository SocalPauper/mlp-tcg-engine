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

interface SiteStatsData {
  newAccountsToday: number;
  gamesCreated: number;
  gamesPlayedToday: number;
  ponyPointsSpent: number;
  totalWebsiteVisits: number;
  totalRegisteredUsers: number;
  openBugReports: number;
  cachedAt?: string;
  refreshIntervalLabel?: string;
}

interface GlobalAnnouncementItem {
  id: string | number;
  message: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ChatMessageItem {
  id: string | number;
  channel: 'HUB' | 'FAN_PAGE' | string;
  authorName: string;
  authorId?: string;
  content: string;
  isCensored?: boolean;
  createdAt?: string;
}

type AdminTabKey =
  | 'STATS'
  | 'ANNOUNCEMENTS'
  | 'CHAT_MOD'
  | 'BUGS'
  | 'USERS'
  | 'THEME_BINDER'
  | 'AUDIT';

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

const ADMIN_TABS: { key: AdminTabKey; label: string }[] = [
  { key: 'STATS', label: '📊 Website Stats' },
  { key: 'ANNOUNCEMENTS', label: '📢 Announcements' },
  { key: 'CHAT_MOD', label: '💬 Chat Moderation' },
  { key: 'BUGS', label: '🐞 Bug Tracker' },
  { key: 'USERS', label: '👥 Users & Moderation' },
  { key: 'THEME_BINDER', label: '🎨 Theme & Binder' },
  { key: 'AUDIT', label: '🏆 Meta & Audit' },
];

export default function AdminPanel() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTabKey>('STATS');

  // Website Statistics State
  const [siteStats, setSiteStats] = useState<SiteStatsData>({
    newAccountsToday: 0,
    gamesCreated: 0,
    gamesPlayedToday: 0,
    ponyPointsSpent: 0,
    totalWebsiteVisits: 0,
    totalRegisteredUsers: 0,
    openBugReports: 0,
    refreshIntervalLabel: 'Updates hourly (cached)',
  });
  const [loadingStats, setLoadingStats] = useState(false);

  // Global Announcements State
  const [announcement, setAnnouncement] = useState('');
  const [announcementsList, setAnnouncementsList] = useState<GlobalAnnouncementItem[]>([]);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | number | null>(null);
  const [editingAnnouncementText, setEditingAnnouncementText] = useState('');
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);

  // Chat Moderation State
  const [chatChannelFilter, setChatChannelFilter] = useState<'ALL' | 'HUB' | 'FAN_PAGE'>('ALL');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);

  // Theme & Binder States
  const [selectedBgTab, setSelectedBgTab] = useState<string>('hub');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [opacity, setOpacity] = useState<number>(1.0);
  const [savingOpacity, setSavingOpacity] = useState(false);
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

  // Meta Deck Importer States (for Current Meta tab)
  const [metaDeckName, setMetaDeckName] = useState('');
  const [metaDeckAuthor, setMetaDeckAuthor] = useState('Equestria Meta Archive');
  const [metaDecklistText, setMetaDecklistText] = useState('');
  const [importingMetaDeck, setImportingMetaDeck] = useState(false);

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
          if (data.settings.site_announcement && announcementsList.length === 0) {
            setAnnouncementsList([
              {
                id: 'current-banner',
                message: data.settings.site_announcement,
                updatedBy: 'Admin',
              },
            ]);
          }
        }
      })
      .catch((err) => console.error('Failed to load admin settings:', err));

    fetchSiteStats(false);
    fetchAnnouncements();
    fetchChatMessages('ALL');
    fetchUsers('');
    fetchCards();
    fetchBugReports();
  }, []);

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchSiteStats = async (forceRefresh = false) => {
    setLoadingStats(true);
    try {
      const url = `${API_BASE_URL}/api/admin/stats${forceRefresh ? '?refresh=1' : ''}`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.stats) {
        setSiteStats((prev) => ({ ...prev, ...data.stats }));
      }
    } catch (err) {
      console.error('Failed to load website statistics:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  const fetchAnnouncements = async () => {
    setLoadingAnnouncements(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/announcements`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.announcements)) {
        setAnnouncementsList(data.announcements);
      }
    } catch (err) {
      console.error('Failed to fetch announcements:', err);
    } finally {
      setLoadingAnnouncements(false);
    }
  };

  const postAnnouncement = async () => {
    const trimmed = announcement.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/announcements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          message: trimmed,
          updatedBy: user?.username || 'admin',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.announcement) {
          setAnnouncementsList((prev) => [data.announcement, ...prev]);
        } else {
          await fetchAnnouncements();
        }
        setAnnouncement('');
        alert('Global Announcement published!');
        return;
      }
    } catch {
      // Fallback to media settings endpoint if dedicated route is not yet mounted
    }

    await fetch(`${API_BASE_URL}/api/media/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'site_announcement',
        value: trimmed,
        updatedBy: user?.username || 'admin',
      }),
    });
    setAnnouncementsList((prev) => [
      { id: Date.now(), message: trimmed, updatedBy: user?.username || 'admin', createdAt: new Date().toISOString() },
      ...prev,
    ]);
    setAnnouncement('');
    alert(`Global Announcement Published: "${trimmed}"`);
  };

  const handleSaveEditedAnnouncement = async (id: string | number) => {
    const trimmed = editingAnnouncementText.trim();
    if (!trimmed) return;

    const numericId = typeof id === 'number' ? id : Number(id);
    const isPersistedRow = Number.isInteger(numericId) && numericId > 0;

    try {
      const endpoint = isPersistedRow
        ? `${API_BASE_URL}/api/admin/announcements/${numericId}`
        : `${API_BASE_URL}/api/admin/announcements`;
      const method = isPersistedRow ? 'PATCH' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          message: trimmed,
          updatedBy: user?.username || 'admin',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        alert(data.error || `Failed to save announcement edit (HTTP ${res.status}).`);
        return;
      }

      if (data.announcement) {
        setAnnouncementsList((prev) =>
          isPersistedRow
            ? prev.map((item) => (item.id === id ? data.announcement : item))
            : [data.announcement, ...prev.filter((item) => item.id !== id)]
        );
      } else {
        await fetchAnnouncements();
      }
      setEditingAnnouncementId(null);
      setEditingAnnouncementText('');
    } catch (err: any) {
      console.error('Failed to update announcement:', err);
      alert(`Network error saving announcement: ${err?.message || 'Unknown error'}`);
    }
  };

  const handleDeleteAnnouncement = async (id: string | number) => {
    if (!window.confirm('Delete this global announcement?')) return;
    try {
      await fetch(`${API_BASE_URL}/api/admin/announcements/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
    } catch (err) {
      console.error('Failed to delete announcement:', err);
    }
    setAnnouncementsList((prev) => prev.filter((item) => item.id !== id));
    if (editingAnnouncementId === id) {
      setEditingAnnouncementId(null);
      setEditingAnnouncementText('');
    }
  };

  const fetchChatMessages = async (channel: 'ALL' | 'HUB' | 'FAN_PAGE') => {
    setLoadingChat(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/admin/chat-messages?channel=${encodeURIComponent(channel)}`,
        { headers: authHeaders() }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.messages)) {
        setChatMessages(data.messages);
      }
    } catch (err) {
      console.error('Failed to fetch chat messages:', err);
    } finally {
      setLoadingChat(false);
    }
  };

  const handleCensorChatMessage = async (msgId: string | number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/chat-messages/${msgId}/censor`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ replacement: '[Message censored by moderator]' }),
      });
      if (res.ok) {
        const data = await res.json();
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? data.message || { ...m, content: '[Message censored by moderator]', isCensored: true }
              : m
          )
        );
        return;
      }
    } catch (err) {
      console.error('Failed to censor message:', err);
    }

    setChatMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, content: '[Message censored by moderator]', isCensored: true } : m
      )
    );
  };

  const handleDeleteChatMessage = async (msgId: string | number) => {
    if (!window.confirm('Permanently delete this chat message?')) return;
    try {
      await fetch(`${API_BASE_URL}/api/admin/chat-messages/${msgId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
    } catch (err) {
      console.error('Failed to delete message:', err);
    }
    setChatMessages((prev) => prev.filter((m) => m.id !== msgId));
  };

  const fetchUsers = async (query: string) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/admin/users?search=${encodeURIComponent(query)}`,
        { headers: authHeaders() }
      );
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
      const res = await fetch(`${API_BASE_URL}/api/admin/bug-reports`, {
        headers: authHeaders(),
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
      const res = await fetch(`${API_BASE_URL}/api/admin/bug-reports/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
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
      const res = await fetch(`${API_BASE_URL}/api/admin/bug-reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
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
      const res = await fetch(`${API_BASE_URL}/api/admin/bug-reports/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
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

  const handleExportAllOpenTickets = () => {
    const openTickets = bugReports.filter((b) => b.status !== 'RESOLVED');
    if (openTickets.length === 0) {
      alert('No open or in-progress tickets to export!');
      return;
    }

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      totalOpenTickets: openTickets.length,
      tickets: openTickets.map((t) => ({
        id: t.id,
        priority: t.priority || 'MEDIUM',
        status: t.status,
        category: t.category,
        reporter: t.reporter_name,
        roomCode: t.room_code,
        seat: t.seat,
        summary: t.summary,
        createdAt: t.created_at,
        adminNotes: t.admin_notes || [],
        flaggedAnomalies: t.diagnostic_clues?.flaggedAnomalies || [],
        diagnosticClues: t.diagnostic_clues || null,
        boardSnapshot: t.board_snapshot || null,
      })),
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `equestria-clash-open-tickets-${dateStamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportMetaDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!metaDeckName.trim() || !metaDecklistText.trim()) return;
    setImportingMetaDeck(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/seed-meta-decks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          decks: [
            {
              name: metaDeckName.trim(),
              author: metaDeckAuthor.trim() || 'Equestria Meta Archive',
              decklistText: metaDecklistText,
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to import meta decklist.');
        return;
      }
      const warn =
        Array.isArray(data.unknownIds) && data.unknownIds.length > 0
          ? `\nSkipped unrecognized IDs: ${data.unknownIds.join(', ')}`
          : '';
      alert(`🏆 Published "${metaDeckName.trim()}" to Current Meta!${warn}`);
      setMetaDeckName('');
      setMetaDecklistText('');
    } catch (err) {
      console.error('Meta deck import failed:', err);
      alert('Network error importing meta deck.');
    } finally {
      setImportingMetaDeck(false);
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

  const handleAwardPointsSubmit = async () => {
    if (!selectedUser) return;
    const pts = parseInt(awardPointsInput, 10);
    if (isNaN(pts)) return alert('Please enter a valid number of points.');

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/users/award-points`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
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

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/users/gift-card`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
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

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/users/moderate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
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

  const filteredChatMessages = chatMessages.filter((m) => {
    const channelOk = chatChannelFilter === 'ALL' || m.channel === chatChannelFilter;
    const q = chatSearchQuery.trim().toLowerCase();
    const searchOk =
      !q ||
      String(m.authorName || '').toLowerCase().includes(q) ||
      String(m.content || '').toLowerCase().includes(q);
    return channelOk && searchOk;
  });

  const openBugCount = bugReports.filter((b) => b.status !== 'RESOLVED').length;
  const currentTabBgUrl = settings[`bg_${selectedBgTab}`] || '';
  const currentBinderCoverUrl = settings['bg_binder_cover'] || '';

  return (
    <div
      className="admin-container"
      style={settings['bg_admin'] ? { backgroundImage: `url(${settings['bg_admin']})` } : undefined}
    >
      <div className="admin-header-row">
        <h1>🛡️ Admin Control Panel</h1>
        <span className="admin-role-pill">
          Logged in as <strong>{user?.username || 'Admin'}</strong>
        </span>
      </div>

      {/* SELECTABLE MODULE TABS */}
      <nav className="admin-tab-bar" aria-label="Admin Modules">
        {ADMIN_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`admin-tab-btn ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
            {t.key === 'BUGS' && openBugCount > 0 && (
              <span className="admin-tab-badge">{openBugCount}</span>
            )}
          </button>
        ))}
      </nav>

      {/* ===================================================================== */}
      {/* TAB 1: WEBSITE STATISTICS (LIVE CACHED METRICS)                       */}
      {/* ===================================================================== */}
      {activeTab === 'STATS' && (
        <div className="panel-box">
          <div className="admin-panel-topbar">
            <div>
              <h3>📊 Website Statistics</h3>
              <p className="admin-subtext">
                {siteStats.refreshIntervalLabel || 'Cached snapshot updated hourly to minimize DB load'}
                {siteStats.cachedAt ? ` • Last updated: ${new Date(siteStats.cachedAt).toLocaleString()}` : ''}
              </p>
            </div>
            <button
              type="button"
              className="admin-ghost-btn"
              onClick={() => fetchSiteStats(true)}
              disabled={loadingStats}
            >
              {loadingStats ? 'Refreshing...' : '🔄 Refresh Now'}
            </button>
          </div>

          <div className="admin-stats-grid">
            <div className="admin-stat-card">
              <span className="admin-stat-label">New Accounts Today</span>
              <strong className="admin-stat-value">{siteStats.newAccountsToday}</strong>
              <span className="admin-stat-meta">Total Users: {siteStats.totalRegisteredUsers}</span>
            </div>

            <div className="admin-stat-card">
              <span className="admin-stat-label">Games Created / Played</span>
              <strong className="admin-stat-value">{siteStats.gamesCreated}</strong>
              <span className="admin-stat-meta">Played Today: {siteStats.gamesPlayedToday}</span>
            </div>

            <div className="admin-stat-card">
              <span className="admin-stat-label">Pony Points Spent</span>
              <strong className="admin-stat-value">🪙 {siteStats.ponyPointsSpent}</strong>
              <span className="admin-stat-meta">Shop &amp; unlock debits</span>
            </div>

            <div className="admin-stat-card">
              <span className="admin-stat-label">Total Website Visits</span>
              <strong className="admin-stat-value">{siteStats.totalWebsiteVisits}</strong>
              <span className="admin-stat-meta">Open Bugs: {siteStats.openBugReports}</span>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: GLOBAL ANNOUNCEMENTS (PUBLISH, EDIT & DELETE)                  */}
      {/* ===================================================================== */}
      {activeTab === 'ANNOUNCEMENTS' && (
        <div className="panel-box">
          <div className="admin-panel-topbar">
            <div>
              <h3>📢 Post &amp; Manage Global Announcements</h3>
              <p className="admin-subtext">
                Publish site-wide banners, edit existing announcements to fix typos, or delete outdated notices.
              </p>
            </div>
            <button
              type="button"
              className="admin-ghost-btn"
              onClick={fetchAnnouncements}
              disabled={loadingAnnouncements}
            >
              {loadingAnnouncements ? 'Refreshing...' : '🔄 Refresh'}
            </button>
          </div>

          <div className="announcement-composer-row">
            <textarea
              rows={2}
              placeholder="Type a new global announcement broadcast for all users..."
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
            />
            <button type="button" onClick={postAnnouncement} className="mlp-btn announcement-publish-btn">
              Publish Announcement
            </button>
          </div>

          <div className="admin-list-stack">
            {announcementsList.length === 0 ? (
              <div className="admin-empty-state">No global announcements posted yet.</div>
            ) : (
              announcementsList.map((item) => {
                const isEditing = editingAnnouncementId === item.id;
                return (
                  <div key={item.id} className="admin-list-card">
                    {isEditing ? (
                      <div className="announcement-edit-box">
                        <textarea
                          rows={2}
                          value={editingAnnouncementText}
                          onChange={(e) => setEditingAnnouncementText(e.target.value)}
                        />
                        <div className="mod-buttons">
                          <button
                            type="button"
                            className="admin-action-btn save"
                            onClick={() => handleSaveEditedAnnouncement(item.id)}
                          >
                            💾 Save Edit
                          </button>
                          <button
                            type="button"
                            className="admin-action-btn cancel"
                            onClick={() => {
                              setEditingAnnouncementId(null);
                              setEditingAnnouncementText('');
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="admin-list-card-row">
                        <div className="admin-list-card-body">
                          <div className="admin-list-message">{item.message}</div>
                          <div className="admin-list-meta">
                            By <strong>{item.updatedBy || 'Admin'}</strong>
                            {item.updatedAt
                              ? ` • Edited ${new Date(item.updatedAt).toLocaleString()}`
                              : item.createdAt
                              ? ` • Posted ${new Date(item.createdAt).toLocaleString()}`
                              : ''}
                          </div>
                        </div>
                        <div className="mod-buttons">
                          <button
                            type="button"
                            className="admin-action-btn edit"
                            onClick={() => {
                              setEditingAnnouncementId(item.id);
                              setEditingAnnouncementText(item.message);
                            }}
                          >
                            ✏️ Edit
                          </button>
                          <button
                            type="button"
                            className="admin-action-btn danger"
                            onClick={() => handleDeleteAnnouncement(item.id)}
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: MAIN HUB & FAN PAGE CHAT MODERATION (CENSOR & DELETE)          */}
      {/* ===================================================================== */}
      {activeTab === 'CHAT_MOD' && (
        <div className="panel-box">
          <div className="admin-panel-topbar">
            <div>
              <h3>💬 Main Hub &amp; Fan Page Chat Moderation</h3>
              <p className="admin-subtext">
                Censor inappropriate text or permanently delete messages across the Main Hub and Fan Page chats.
              </p>
            </div>
            <button
              type="button"
              className="admin-ghost-btn"
              onClick={() => fetchChatMessages(chatChannelFilter)}
              disabled={loadingChat}
            >
              {loadingChat ? 'Refreshing...' : '🔄 Refresh'}
            </button>
          </div>

          <div className="admin-filter-row">
            <select
              value={chatChannelFilter}
              onChange={(e) => {
                const next = e.target.value as 'ALL' | 'HUB' | 'FAN_PAGE';
                setChatChannelFilter(next);
                fetchChatMessages(next);
              }}
              style={{ maxWidth: '210px' }}
            >
              <option value="ALL">All Channels (Hub &amp; Fan Page)</option>
              <option value="HUB">🏠 Main Hub Chat</option>
              <option value="FAN_PAGE">🌟 Fan Page Chat</option>
            </select>

            <input
              type="text"
              placeholder="Filter by username or message text..."
              value={chatSearchQuery}
              onChange={(e) => setChatSearchQuery(e.target.value)}
              style={{ maxWidth: '340px' }}
            />
          </div>

          <div className="admin-list-stack">
            {filteredChatMessages.length === 0 ? (
              <div className="admin-empty-state">No chat messages match the current filter.</div>
            ) : (
              filteredChatMessages.map((msg) => (
                <div key={msg.id} className="admin-list-card">
                  <div className="admin-list-card-row">
                    <div className="admin-list-card-body">
                      <div className="chat-msg-header">
                        <span className={`chat-channel-tag ch-${msg.channel}`}>
                          {msg.channel === 'FAN_PAGE' ? '🌟 Fan Page' : '🏠 Main Hub'}
                        </span>
                        <strong>{msg.authorName}</strong>
                        {msg.isCensored && <span className="chat-censored-pill">CENSORED</span>}
                        {msg.createdAt && (
                          <span className="admin-list-meta">
                            • {new Date(msg.createdAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                      <div className={`admin-list-message ${msg.isCensored ? 'is-censored' : ''}`}>
                        {msg.content}
                      </div>
                    </div>

                    <div className="mod-buttons">
                      <button
                        type="button"
                        className="admin-action-btn censor"
                        disabled={Boolean(msg.isCensored)}
                        onClick={() => handleCensorChatMessage(msg.id)}
                      >
                        🚫 Censor
                      </button>
                      <button
                        type="button"
                        className="admin-action-btn danger"
                        onClick={() => handleDeleteChatMessage(msg.id)}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: ALPHA BUG REPORTS & PROGRESS TRACKER                           */}
      {/* ===================================================================== */}
      {activeTab === 'BUGS' && (
        <div className="panel-box">
          <div className="admin-panel-topbar">
            <div>
              <h3>🐞 Alpha Bug Reports &amp; Progress Tracker ({filteredBugs.length})</h3>
              <p className="admin-subtext">
                Triage player bug reports, inspect auto-captured engine clues, set priority, and log progress notes.
              </p>
            </div>

            <div className="mod-buttons">
              <button
                type="button"
                className="admin-action-btn inspect"
                onClick={handleExportAllOpenTickets}
                title="Download all OPEN and IN_PROGRESS bug reports as a single JSON file"
              >
                📦 Export Open Tickets ({openBugCount})
              </button>
              <button
                type="button"
                className="admin-action-btn edit"
                onClick={() => setShowNewBugForm((prev) => !prev)}
              >
                {showNewBugForm ? '✕ Close Form' : '+ Log New Bug'}
              </button>
              <button
                type="button"
                className="admin-ghost-btn"
                onClick={fetchBugReports}
                disabled={loadingBugs}
              >
                {loadingBugs ? 'Refreshing...' : '🔄 Refresh'}
              </button>
            </div>
          </div>

          {showNewBugForm && (
            <form onSubmit={handleCreateManualBug} className="admin-subform-box">
              <strong style={{ color: '#fde047', fontSize: '14px' }}>➕ Add New Bug / Alpha Task</strong>
              <div className="admin-filter-row">
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
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" className="mlp-btn">
                  Save Bug Entry 💾
                </button>
              </div>
            </form>
          )}

          <div className="admin-filter-row">
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

          <div className="admin-list-stack">
            {filteredBugs.length === 0 ? (
              <div className="admin-empty-state">No bug reports match the selected filters.</div>
            ) : (
              filteredBugs.map((bug) => {
                const prio = bug.priority || 'MEDIUM';
                const notes = Array.isArray(bug.admin_notes) ? bug.admin_notes : [];
                const anomalies: string[] = bug.diagnostic_clues?.flaggedAnomalies || [];

                return (
                  <div
                    key={bug.id}
                    className="admin-list-card"
                    style={{ borderColor: PRIORITY_COLORS[prio] || '#a855f7' }}
                  >
                    <div className="admin-list-card-row">
                      <div className="admin-list-card-body">
                        <div className="chat-msg-header">
                          <strong style={{ color: '#fde047', fontSize: '15px' }}>#{bug.id}</strong>
                          <span
                            className="bug-badge"
                            style={{ background: PRIORITY_COLORS[prio] || '#eab308', color: '#111827' }}
                          >
                            {prio}
                          </span>
                          <span
                            className="bug-badge"
                            style={{ background: STATUS_COLORS[bug.status] || '#f43f5e', color: '#fff' }}
                          >
                            {bug.status}
                          </span>
                          <span className="admin-list-meta">
                            by <strong>{bug.reporter_name}</strong> • {bug.category}
                            {bug.room_code ? ` • Room: ${bug.room_code}` : ''}
                            {bug.seat ? ` (Seat ${bug.seat})` : ''}
                          </span>
                        </div>
                        <div className="admin-list-message">{bug.summary}</div>
                        <div className="admin-list-meta">
                          Reported: {new Date(bug.created_at).toLocaleString()}
                        </div>
                      </div>

                      <div className="mod-buttons">
                        <select
                          value={prio}
                          onChange={(e) => handleUpdateBug(bug.id, { priority: e.target.value })}
                          style={{ width: 'auto', padding: '4px 8px', fontSize: '11.5px' }}
                        >
                          <option value="CRITICAL">Critical</option>
                          <option value="HIGH">High</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="LOW">Low</option>
                        </select>

                        <select
                          value={bug.status}
                          onChange={(e) => handleUpdateBug(bug.id, { status: e.target.value })}
                          style={{ width: 'auto', padding: '4px 8px', fontSize: '11.5px' }}
                        >
                          <option value="OPEN">OPEN</option>
                          <option value="IN_PROGRESS">IN_PROGRESS</option>
                          <option value="RESOLVED">RESOLVED</option>
                        </select>

                        {(bug.diagnostic_clues || bug.board_snapshot) && (
                          <button
                            type="button"
                            className="admin-action-btn inspect"
                            onClick={() => setInspectedBug(bug)}
                          >
                            🔍 Clues
                          </button>
                        )}

                        <button
                          type="button"
                          className="admin-ghost-btn"
                          style={{ padding: '5px 9px', fontSize: '11.5px' }}
                          onClick={() => handleDownloadBugJson(bug)}
                        >
                          📥 JSON
                        </button>

                        <button
                          type="button"
                          className="admin-action-btn danger"
                          style={{ padding: '5px 9px', fontSize: '11.5px' }}
                          onClick={() => handleDeleteBug(bug.id)}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {anomalies.length > 0 && (
                      <div className="bug-anomalies-box">
                        <strong>⚠️ Auto-Detected Engine Clues:</strong>
                        <ul>
                          {anomalies.slice(-3).map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {notes.length > 0 && (
                      <div className="bug-notes-box">
                        <span>💬 Progress Notes ({notes.length}):</span>
                        {notes.map((n) => (
                          <div key={n.id} className="bug-note-line">
                            <strong>{n.author}</strong> <span>({new Date(n.createdAt).toLocaleString()})</span>: {n.text}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="announcement-composer-row">
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
                      />
                      <button
                        type="button"
                        className="admin-action-btn save"
                        onClick={() => {
                          if ((commentDrafts[bug.id] || '').trim()) {
                            handleUpdateBug(bug.id, { newComment: commentDrafts[bug.id] });
                          }
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
      )}

      {/* ===================================================================== */}
      {/* TAB 5: USER MANAGEMENT, POINTS, GIFTING & MODERATION                  */}
      {/* ===================================================================== */}
      {activeTab === 'USERS' && (
        <div className="panel-box">
          <h3>👥 User Management, Points, Gifting &amp; Moderation</h3>
          <p className="admin-subtext">
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
            style={{ maxWidth: '420px' }}
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
            <div className="admin-selected-user-box">
              <div className="admin-panel-topbar">
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
                  className="admin-action-btn cancel"
                  onClick={() => setSelectedUser(null)}
                >
                  Deselect
                </button>
              </div>

              <div className="mod-buttons">
                <button
                  type="button"
                  className="admin-action-btn points"
                  onClick={() => setActiveModal('POINTS')}
                >
                  🪙 Award Pony Points
                </button>
                <button
                  type="button"
                  className="admin-action-btn edit"
                  onClick={() => setActiveModal('CARD')}
                >
                  🎁 Gift Specific Card
                </button>
                <button
                  type="button"
                  className="admin-action-btn censor"
                  onClick={() => handleModerationAction('SILENCE')}
                >
                  🔇 Silence
                </button>
                <button
                  type="button"
                  className="admin-action-btn suspend"
                  onClick={() => handleModerationAction('SUSPEND')}
                >
                  ⏳ Suspend
                </button>
                <button
                  type="button"
                  className="admin-action-btn danger"
                  onClick={() => handleModerationAction('BAN')}
                >
                  🚫 Ban User
                </button>
                <button
                  type="button"
                  className="admin-action-btn save"
                  onClick={() => handleModerationAction('ACTIVE')}
                >
                  ✅ Restore Active
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 6: GLOBAL THEME, TAB BACKGROUNDS & BINDER COVER                  */}
      {/* ===================================================================== */}
      {activeTab === 'THEME_BINDER' && (
        <div className="admin-two-col-grid">
          <div className="panel-box">
            <h3>🎨 Global Tab Background &amp; Opacity</h3>
            <p className="admin-subtext">
              Upload wallpapers to R2 and adjust background opacity globally for all visitors.
            </p>
            <label className="admin-field-label">
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
              <div className="admin-preview-box">
                <img
                  src={currentTabBgUrl}
                  alt="Active Wallpaper Preview"
                  style={{ width: '100%', height: '120px', objectFit: 'cover', opacity }}
                />
              </div>
            )}

            <label className="admin-field-label">
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

          <div className="panel-box">
            <h3>📖 Collection Binder Cover &amp; Title</h3>
            <p className="admin-subtext">
              Customize the closed 3-ring binder front cover art and global album name for all players.
            </p>

            <label className="admin-field-label">
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

            <div>
              <span className="admin-field-label" style={{ marginBottom: '6px' }}>
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
              <div className="admin-preview-box gold">
                <img
                  src={currentBinderCoverUrl}
                  alt="Binder Cover Preview"
                  style={{ width: '100%', height: '140px', objectFit: 'cover' }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 7: META DECK IMPORTER & CONTENT AUDIT                             */}
      {/* ===================================================================== */}
      {activeTab === 'AUDIT' && (
        <div className="admin-two-col-grid">
          <form onSubmit={handleImportMetaDeck} className="panel-box">
            <h3>🏆 Publish Decklist to Current Meta</h3>
            <p className="admin-subtext">
              Paste any decklist exported from PonyRec or DreamTCG (e.g., <code>1x SD01-RR04</code>,{' '}
              <code>4x BP04-SR01</code>). The server automatically sorts Mane, Story, Scene, and Main cards.
            </p>

            <label className="admin-field-label">
              Meta Deck Name:
              <input
                type="text"
                required
                placeholder="e.g., Applejack Ramp (BP04 Top Cut)"
                value={metaDeckName}
                onChange={(e) => setMetaDeckName(e.target.value)}
              />
            </label>

            <label className="admin-field-label">
              Pilot / Source Credit:
              <input
                type="text"
                placeholder="e.g., Equestria Meta Archive / DreamTCG"
                value={metaDeckAuthor}
                onChange={(e) => setMetaDeckAuthor(e.target.value)}
              />
            </label>

            <label className="admin-field-label">
              Card IDs &amp; Quantities:
              <textarea
                rows={8}
                required
                placeholder={`1x SD01-RR04\n1x SD01D-C06\n1x SD01D-C07\n1x SD01D-C08\n1x SD01D-C09\n15x SD01-ER04\n4x SD01D-SR01\n...`}
                value={metaDecklistText}
                onChange={(e) => setMetaDecklistText(e.target.value)}
              />
            </label>

            <button type="submit" disabled={importingMetaDeck} className="mlp-btn">
              {importingMetaDeck ? 'Importing Deck...' : '🏆 Publish to Current Meta'}
            </button>
          </form>

          <div className="panel-box">
            <h3>🔍 Audit Decks &amp; Content</h3>
            <p className="admin-subtext">
              Review user-submitted deck lists for Rules v1.3.0 compliance and manage public featured lists.
            </p>
            <div>
              <button type="button" className="mlp-btn">
                Audit Database Decks
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: AWARD PONY POINTS */}
      {activeModal === 'POINTS' && selectedUser && (
        <div className="admin-modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, color: '#ffd700' }}>🪙 Award Pony Points</h3>
            <p className="admin-subtext">
              Grant Pony Points to user <strong>{selectedUser.username}</strong>:
            </p>
            <input
              type="number"
              placeholder="Enter number of points..."
              value={awardPointsInput}
              onChange={(e) => setAwardPointsInput(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button type="button" className="admin-action-btn cancel" onClick={() => setActiveModal(null)}>
                Cancel
              </button>
              <button type="button" className="admin-action-btn points" onClick={handleAwardPointsSubmit}>
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
            <p className="admin-subtext">
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

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button type="button" className="admin-action-btn cancel" onClick={() => setActiveModal(null)}>
                Cancel
              </button>
              <button type="button" className="admin-action-btn edit" onClick={handleGiftCardSubmit}>
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
            <div className="admin-panel-topbar">
              <h3 style={{ margin: 0, color: '#fde047' }}>
                🔍 Diagnostic Clues — Bug #{inspectedBug.id}
              </h3>
              <button type="button" className="admin-action-btn cancel" onClick={() => setInspectedBug(null)}>
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
                <pre className="admin-json-pre">
                  {JSON.stringify(inspectedBug.diagnostic_clues, null, 2)}
                </pre>
              </>
            )}

            {inspectedBug.board_snapshot && (
              <>
                <strong style={{ color: '#f472b6', fontSize: '12.5px' }}>
                  Full Board Snapshot &amp; Debug Trace:
                </strong>
                <pre className="admin-json-pre">
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