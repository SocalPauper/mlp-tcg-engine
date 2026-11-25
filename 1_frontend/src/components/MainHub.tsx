import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../App';
import { API_BASE_URL } from '../config';
import { LiveGameState } from './GameBoard';
import './MainHub.css';

interface SelectableDeck {
  id: string;
  name: string;
  element: string;
  is_starter: boolean;
  mane_image_url?: string | null;
}

interface LobbyRoom {
  code: string;
  name: string;
  host: string;
  mode: 'Casual' | 'Ranked';
  hasPassword: boolean;
  status: 'Waiting' | 'In-Progress';
  allowSpectators: boolean;
  playerCount: number;
}

interface HubChatEntry {
  id?: string | number;
  user: string;
  text: string;
  isCensored?: boolean;
}

interface MainHubProps {
  onMatchJoined: (ws: WebSocket, state: LiveGameState, seat: '0' | '1' | 'spectator') => void;
  onNavigateTab?: (tab: string) => void;
}

const DEFAULT_STARTER_DECKS: SelectableDeck[] = [
  {
    id: 'starter-sd01',
    name: 'Twilight Sparkle - Magic Starter',
    element: 'Magic',
    is_starter: true,
    mane_image_url: 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/SD01-RR01.webp',
  },
  {
    id: 'starter-sd02',
    name: 'Rainbow Dash - Loyalty Starter',
    element: 'Loyalty',
    is_starter: true,
    mane_image_url: 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/SD01-RR05.webp',
  },
  {
    id: 'starter-sd03',
    name: 'Applejack - Honesty Starter',
    element: 'Honesty',
    is_starter: true,
    mane_image_url: 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/SD01-RR04.webp',
  },
  {
    id: 'starter-sd04',
    name: 'Rarity - Generosity Starter',
    element: 'Generosity',
    is_starter: true,
    mane_image_url: 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/SD01-RR06.webp',
  },
  {
    id: 'starter-sd05',
    name: 'Fluttershy - Kindness Starter',
    element: 'Kindness',
    is_starter: true,
    mane_image_url: 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/SD01-RR02.webp',
  },
  {
    id: 'starter-sd06',
    name: 'Pinkie Pie - Laughter Starter',
    element: 'Laughter',
    is_starter: true,
    mane_image_url: 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/SD01-RR03.webp',
  },
];

const KAYOU_MLP_NEWS = [
  {
    title: "Kayou × Hasbro U.S. Set 4: Hearth's Warming Eve",
    date: '2026 Release',
    snippet:
      'Featuring 197 holiday-themed cards including Special Parallel Rare (SPR) and Crystal Rare (CR) Mane 6 chases.',
  },
  {
    title: 'Kayou MLP TCG: Nightmare Night Expansion',
    date: '2026 Release',
    snippet:
      '190 spooky cards bringing Princess Luna, Nightmare Moon, and seasonal Story stages to North American play.',
  },
  {
    title: 'KAYOU × BOOM! Studios Exclusive Comic Promo',
    date: 'Collector News',
    snippet:
      'Special commemorative promo cards bundled with My Little Pony comic issues across participating hobby shops.',
  },
  {
    title: 'Moon Edition 2 & Friendship Eternal Wave',
    date: 'Official Catalog',
    snippet:
      'Expanded English-language card pool with gold-foil UR/GR variants—check kayouofficial.com for product checklists.',
  },
];

const WELCOME_CHAT_MSG: HubChatEntry = {
  id: 'welcome-celestia',
  user: 'Princess Celestia',
  text: 'Welcome, verified duelists of Equestria! Share your deck tech and good sportsmanship here. ✨',
};

export default function MainHub({ onMatchJoined, onNavigateTab }: MainHubProps) {
  const { user } = useAuth();
  const isGuest = !user;

  const isSafeMode = user?.isSafeMode ?? true;
  const canChat = Boolean(user && !isSafeMode && (user.isVerified || user.role === 'admin'));

  const wsRef = useRef<WebSocket | null>(null);
  const [starterDecks, setStarterDecks] = useState<SelectableDeck[]>(DEFAULT_STARTER_DECKS);
  const [availableDecks, setAvailableDecks] = useState<SelectableDeck[]>(DEFAULT_STARTER_DECKS);
  const [liveRooms, setLiveRooms] = useState<LobbyRoom[]>([]);

  const [matchMode, setMatchMode] = useState<'Casual' | 'Ranked'>('Casual');
  const [selectedDeck, setSelectedDeck] = useState<string>(() => {
    return localStorage.getItem('mlp_last_deck_id') || 'starter-sd01';
  });
  const [showDeckPickerModal, setShowDeckPickerModal] = useState(false);

  const [showQuickPlayStarterModal, setShowQuickPlayStarterModal] = useState(false);
  const [quickPlayStarterId, setQuickPlayStarterId] = useState<string>('starter-sd01');
  const [isSearchingQueue, setIsSearchingQueue] = useState(false);
  const [queueStatusText, setQueueStatusText] = useState('Searching for opponent...');

  const [privateRoomName, setPrivateRoomName] = useState('');
  const [privatePassword, setPrivatePassword] = useState('');
  const [allowSpectators, setAllowSpectators] = useState(true);

  const [passwordPromptRoom, setPasswordPromptRoom] = useState<{
    room: LobbyRoom;
    action: 'JOIN' | 'SPECTATE';
  } | null>(null);
  const [joinPasswordInput, setJoinPasswordInput] = useState('');

  const [siteAnnouncement, setSiteAnnouncement] = useState<string>('');
  const [dbChatMessages, setDbChatMessages] = useState<HubChatEntry[]>([]);
  const [inputMsg, setInputMsg] = useState('');

  const [customBgUrl, setCustomBgUrl] = useState<string>('');
  const [bgOpacity, setBgOpacity] = useState<number>(1);

  const playerDisplayName =
    user?.displayName || user?.username || `Pony_${Math.floor(100 + Math.random() * 900)}`;

  useEffect(() => {
    if (sessionStorage.getItem('mlp_visit_recorded')) return;
    sessionStorage.setItem('mlp_visit_recorded', '1');
    fetch(`${API_BASE_URL}/api/admin/visit`, { method: 'POST' }).catch(() => {});
  }, []);

  const loadSettingsAndAnnouncement = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/media/settings`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.success && data.settings) {
        if (data.settings.bg_hub) setCustomBgUrl(data.settings.bg_hub);
        if (data.settings.bg_hub_opacity !== undefined) {
          setBgOpacity(parseFloat(data.settings.bg_hub_opacity));
        }
        setSiteAnnouncement(String(data.settings.site_announcement || '').trim());
      }
    } catch (err) {
      console.error('Error loading global hub theme:', err);
    }
  }, []);

  useEffect(() => {
    loadSettingsAndAnnouncement();
    const timer = setInterval(loadSettingsAndAnnouncement, 8000);
    return () => clearInterval(timer);
  }, [loadSettingsAndAnnouncement]);

  const loadHubChat = useCallback(async () => {
    if (!canChat) return;
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      let res = await fetch(`${API_BASE_URL}/api/admin/chat/feed?channel=HUB`, { headers });
      if (!res.ok) {
        res = await fetch(`${API_BASE_URL}/api/admin/chat-messages?channel=HUB`, { headers });
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data?.success && Array.isArray(data.messages)) {
        const mapped: HubChatEntry[] = [...data.messages].reverse().map((m: any) => ({
          id: m.id,
          user: m.authorName || 'Duelist',
          text: m.content,
          isCensored: Boolean(m.isCensored),
        }));
        setDbChatMessages(mapped);
      }
    } catch {
      // Preserve current messages on transient network errors
    }
  }, [canChat]);

  useEffect(() => {
    if (!canChat) return;
    loadHubChat();
    const poll = setInterval(loadHubChat, 5000);
    return () => clearInterval(poll);
  }, [canChat, loadHubChat]);

  const chatMessages: HubChatEntry[] = React.useMemo(() => {
    const list: HubChatEntry[] = [WELCOME_CHAT_MSG];
    if (siteAnnouncement) {
      list.push({
        id: 'royal-decree',
        user: 'Royal Decree',
        text: siteAnnouncement,
      });
    }
    return [...list, ...dbChatMessages];
  }, [siteAnnouncement, dbChatMessages]);

  useEffect(() => {
    localStorage.setItem('mlp_last_deck_id', selectedDeck);
  }, [selectedDeck]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    Promise.all([
      fetch(`${API_BASE_URL}/api/decks`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).then((res) => (res.ok ? res.json() : [])),
      fetch(`${API_BASE_URL}/api/cards`).then((res) => (res.ok ? res.json() : [])),
    ])
      .then(([decksData, cardsData]: [any[], any[]]) => {
        const maneByElement = new Map<string, string>();
        if (Array.isArray(cardsData)) {
          for (const c of cardsData) {
            const type = String(c.card_type || c.type || '').toLowerCase();
            const el = String(c.element || '').toLowerCase();
            const img = c.image_url || c.imageUrl;
            if (type.includes('mane') && el && img && !maneByElement.has(el)) {
              maneByElement.set(el, img);
            }
          }
        }

        const hydratedStarters = DEFAULT_STARTER_DECKS.map((st) => {
          const fromApi = Array.isArray(decksData)
            ? decksData.find((d) => d.id === st.id)
            : null;
          const dbImg =
            fromApi?.mane_image_url ||
            maneByElement.get(st.element.toLowerCase()) ||
            st.mane_image_url;
          return {
            ...st,
            name: fromApi?.name || st.name,
            mane_image_url: dbImg,
          };
        });

        setStarterDecks(hydratedStarters);

        if (!Array.isArray(decksData) || decksData.length === 0) {
          setAvailableDecks(hydratedStarters);
          return;
        }

        const starterImgMap = new Map(hydratedStarters.map((s) => [s.id, s.mane_image_url]));
        const mapped: SelectableDeck[] = decksData.map((d) => ({
          id: d.id,
          name: d.name,
          element: d.element || 'Unaligned',
          is_starter: Boolean(d.is_starter || String(d.id).startsWith('starter-')),
          mane_image_url:
            d.mane_image_url ||
            starterImgMap.get(d.id) ||
            maneByElement.get(String(d.element || '').toLowerCase()) ||
            'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/CardBack.webp',
        }));

        const filtered = isGuest ? mapped.filter((d) => d.is_starter) : mapped;
        if (filtered.length > 0) {
          setAvailableDecks(filtered);
          if (!filtered.some((d) => d.id === selectedDeck)) {
            setSelectedDeck(filtered[0].id);
          }
        }
      })
      .catch((err) => console.error('Error loading decks:', err));
  }, [isGuest]);

  useEffect(() => {
    const wsUrl = API_BASE_URL.replace(/^http/, 'ws');
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'GET_ROOMS' }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ROOMS_LIST' && Array.isArray(data.rooms)) {
          setLiveRooms(data.rooms);
        } else if (data.type === 'QUEUED') {
          setQueueStatusText(data.message || 'Waiting for opponent...');
        } else if (data.type === 'STATE_UPDATE' && data.state) {
          setIsSearchingQueue(false);
          setShowQuickPlayStarterModal(false);
          onMatchJoined(socket, data.state, data.seat);
        } else if (data.type === 'ERROR') {
          setIsSearchingQueue(false);
          alert(data.message || 'Matchmaking error');
        }
      } catch (err) {
        console.error('[WS PARSE ERROR]', err);
      }
    };

    const roomRefreshInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'GET_ROOMS' }));
      }
    }, 8000);

    return () => {
      clearInterval(roomRefreshInterval);
    };
  }, []);

  const queueWithDeck = (deckIdToUse: string, modeToUse: 'Casual' | 'Ranked') => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert('Connecting to game server... Please try again in a second.');
      return;
    }
    if (modeToUse === 'Ranked' && isGuest) {
      alert('Please sign in to your account to play Ranked placement & ladder matches!');
      return;
    }
    setIsSearchingQueue(true);
    setQueueStatusText(`Joining ${modeToUse} queue...`);
    wsRef.current.send(
      JSON.stringify({
        type: 'QUICK_PLAY',
        deckId: deckIdToUse,
        mode: modeToUse,
        username: playerDisplayName,
        userId: user?.id ? String(user.id) : undefined,
      })
    );
  };

  const handleCancelQueue = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'CANCEL_QUICK_PLAY' }));
    }
    setIsSearchingQueue(false);
  };

  const handleCreatePrivateMatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert('Connecting to game server... Please try again.');
      return;
    }
    const code = `priv-${Math.floor(1000 + Math.random() * 9000)}`;
    wsRef.current.send(
      JSON.stringify({
        type: 'CREATE_ROOM',
        roomCode: code,
        roomName: privateRoomName.trim() || `${playerDisplayName}'s Private Match`,
        mode: matchMode,
        password: privatePassword.trim() || undefined,
        allowSpectators,
        deckId: selectedDeck,
        username: playerDisplayName,
        userId: user?.id ? String(user.id) : undefined,
      })
    );
  };

  const executeRoomAction = (room: LobbyRoom, action: 'JOIN' | 'SPECTATE', suppliedPass = '') => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (action === 'JOIN') {
      wsRef.current.send(
        JSON.stringify({
          type: 'JOIN_ROOM',
          roomCode: room.code,
          password: suppliedPass,
          deckId: selectedDeck,
          username: playerDisplayName,
          userId: user?.id ? String(user.id) : undefined,
        })
      );
    } else {
      wsRef.current.send(
        JSON.stringify({
          type: 'SPECTATE_ROOM',
          roomCode: room.code,
          password: suppliedPass,
        })
      );
    }
  };

  const handleRoomButtonClick = (room: LobbyRoom, action: 'JOIN' | 'SPECTATE') => {
    if (room.hasPassword) {
      setJoinPasswordInput('');
      setPasswordPromptRoom({ room, action });
      return;
    }
    executeRoomAction(room, action);
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputMsg.trim();
    if (!canChat || !trimmed) return;

    const senderName = user?.displayName || user?.username || 'You';
    setInputMsg('');

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/api/admin/chat-messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          channel: 'HUB',
          authorId: user?.id ? String(user.id) : undefined,
          authorName: senderName,
          content: trimmed,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDbChatMessages((prev) => [
          ...prev,
          {
            id: data.message?.id || Date.now(),
            user: senderName,
            text: trimmed,
            isCensored: false,
          },
        ]);
        return;
      }
    } catch {
      // Fallback to local state append if endpoint isn't wired
    }

    setDbChatMessages((prev) => [...prev, { id: Date.now(), user: senderName, text: trimmed }]);
  };

  const currentDeckObj = availableDecks.find((d) => d.id === selectedDeck) || availableDecks[0];

  return (
    <div
      className="hub-container"
      style={{
        backgroundImage: customBgUrl ? `url(${customBgUrl})` : undefined,
        backgroundBlendMode: customBgUrl ? 'overlay' : undefined,
      }}
    >
      {customBgUrl && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#150624',
            opacity: 1 - bgOpacity,
            zIndex: 1,
            pointerEvents: 'none',
          }}
        />
      )}

      <div className="hub-wireframe-layout">
        <div className="hub-left-stack">
          <div className="cloud-panel">
            <h3>☁️ Matchmaking Control Center</h3>

            <div className="matchmaking-grid">
              <div className="match-subbox">
                <span
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 900,
                    color: '#ff9ebb',
                    marginBottom: '10px',
                    textTransform: 'uppercase',
                  }}
                >
                  Match Mode
                </span>
                <div className="mode-radio-group">
                  <label className={`mode-radio-label ${matchMode === 'Casual' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="matchMode"
                      checked={matchMode === 'Casual'}
                      onChange={() => setMatchMode('Casual')}
                    />
                    Casual
                  </label>
                  <label className={`mode-radio-label ${matchMode === 'Ranked' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="matchMode"
                      checked={matchMode === 'Ranked'}
                      onChange={() => setMatchMode('Ranked')}
                    />
                    Ranked (5 Placement Seeding)
                  </label>
                </div>
              </div>

              <div className="match-subbox">
                <span
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 900,
                    color: '#ff9ebb',
                    marginBottom: '10px',
                    textTransform: 'uppercase',
                  }}
                >
                  Active Deck
                </span>
                <div className="deck-select-inner">
                  <div className="deck-current-name">
                    <span>{currentDeckObj ? currentDeckObj.name : 'Default Starter'}</span>
                    <span style={{ fontSize: '11px', color: '#ffd700' }}>
                      {currentDeckObj?.element}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="mlp-cloud-btn secondary"
                    onClick={() => setShowDeckPickerModal(true)}
                  >
                    🃏 Choose Deck ({availableDecks.length})
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="mlp-cloud-btn"
              onClick={() => queueWithDeck(selectedDeck, matchMode)}
            >
              ✨ START {matchMode.toUpperCase()} MATCH ✨
            </button>
          </div>

          <div className="cloud-panel quick-play-module">
            <h3 style={{ marginBottom: '6px', color: '#fffdf7' }}>
              ⚡ Quick Play (Starter Decks Only)
            </h3>
            <p style={{ fontSize: '13.5px', color: '#fce7f3', marginBottom: '16px', maxWidth: '520px' }}>
              Pick one of the six Mane 6 starter decks and jump straight into a balanced casual duel!
            </p>
            <button
              type="button"
              className="mlp-cloud-btn"
              style={{ maxWidth: '300px', padding: '12px 26px', fontSize: '15px' }}
              onClick={() => setShowQuickPlayStarterModal(true)}
            >
              🚀 Quick Play (Pick Starter)
            </button>
          </div>

          <div className="lobby-dual-grid">
            <div className="cloud-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0 }}>🎮 Live Matches &amp; Lobbies</h3>
                <button
                  type="button"
                  className="mlp-cloud-btn secondary small-pill"
                  onClick={() => wsRef.current?.send(JSON.stringify({ type: 'GET_ROOMS' }))}
                >
                  🔄 Refresh
                </button>
              </div>

              {liveRooms.length === 0 ? (
                <div
                  style={{
                    padding: '32px 16px',
                    textAlign: 'center',
                    color: '#e9d5ff',
                    background: 'rgba(18, 5, 29, 0.5)',
                    borderRadius: '20px',
                    border: '1.5px dashed rgba(255, 158, 187, 0.4)',
                    fontSize: '13.5px',
                  }}
                >
                  No open or active games right now. Create a match or start Quick Play!
                </div>
              ) : (
                <div className="live-rooms-list">
                  {liveRooms.map((room) => (
                    <div key={room.code} className="live-room-row">
                      <div className="live-room-meta">
                        <span className="live-room-title">
                          {room.hasPassword ? '🔒 ' : '🌐 '}
                          {room.name}
                        </span>
                        <span className="live-room-sub">
                          Host: {room.host} • {room.mode} • {room.playerCount}/2 Players
                        </span>
                      </div>

                      <div>
                        {room.status === 'Waiting' && room.playerCount < 2 ? (
                          <button
                            type="button"
                            className="mlp-cloud-btn small-pill"
                            onClick={() => handleRoomButtonClick(room, 'JOIN')}
                          >
                            ⚔️ Join
                          </button>
                        ) : room.allowSpectators ? (
                          <button
                            type="button"
                            className="mlp-cloud-btn secondary small-pill"
                            onClick={() => handleRoomButtonClick(room, 'SPECTATE')}
                          >
                            👁️ Spectate
                          </button>
                        ) : (
                          <span style={{ fontSize: '11.5px', color: '#f472b6', fontWeight: 800 }}>
                            🚫 Private View
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="cloud-panel">
              <h3>🔐 Create Private Match</h3>
              <form className="private-match-form" onSubmit={handleCreatePrivateMatch}>
                <input
                  type="text"
                  className="hub-input"
                  placeholder="Room Title (e.g., Friendship Duel)"
                  value={privateRoomName}
                  onChange={(e) => setPrivateRoomName(e.target.value)}
                />
                <input
                  type="password"
                  className="hub-input"
                  placeholder="Room Password (optional)"
                  value={privatePassword}
                  onChange={(e) => setPrivatePassword(e.target.value)}
                />
                <label className="spectator-toggle-row">
                  <span>👁️ Allow Spectators to Watch</span>
                  <input
                    type="checkbox"
                    checked={allowSpectators}
                    onChange={(e) => setAllowSpectators(e.target.checked)}
                  />
                </label>
                <button type="submit" className="mlp-cloud-btn" style={{ padding: '12px 20px', fontSize: '14.5px' }}>
                  ✨ Host Private Room
                </button>
              </form>
            </div>
          </div>

          <div className="hub-bottom-row">
            <div className="cloud-panel">
              <h3>🏆 Ranked Ladder</h3>
              <div className="coming-soon-leaderboard-box">
                <div style={{ fontSize: '36px' }}>👑✨</div>
                <strong style={{ color: '#ffd700', fontSize: '17px' }}>
                  Season 1 Ranked Active!
                </strong>
                <p style={{ margin: 0, fontSize: '13px', color: '#fbcfe8', lineHeight: 1.45 }}>
                  Complete 5 seeding placement matches in Ranked Mode to calibrate your Equestrian Tier and climb the leaderboard.
                </p>
                {onNavigateTab && (
                  <button
                    type="button"
                    className="mlp-cloud-btn secondary small-pill"
                    style={{ marginTop: '6px' }}
                    onClick={() => onNavigateTab('standings')}
                  >
                    📊 View Standings &amp; Placement Progress
                  </button>
                )}
              </div>
            </div>

            <div className="cloud-panel">
              <h3>📜 Kayou MLP TCG News Feed</h3>
              <div className="news-feed-scroll">
                {KAYOU_MLP_NEWS.map((item, idx) => (
                  <div key={idx} className="news-item">
                    <div className="news-header-line">
                      <span className="news-title">{item.title}</span>
                      <span className="news-date-tag">{item.date}</span>
                    </div>
                    <p className="news-snippet">{item.snippet}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="cloud-panel chat-wireframe-panel">
          <div>
            <h3>💬 Equestrian Community Chat</h3>
            <p style={{ fontSize: '12.5px', color: '#fbcfe8', lineHeight: '1.45', margin: '6px 0 10px' }}>
              {canChat
                ? 'Verified duelist chat is active. Keep discussions friendly and respectful!'
                : 'Restricted Area: Only verified accounts over age 13 may read or post in Community Chat.'}
            </p>
          </div>

          {canChat ? (
            <>
              <div className="chat-wireframe-messages">
                {chatMessages.map((msg, i) => (
                  <div
                    key={msg.id ?? i}
                    className="chat-wireframe-msg"
                    style={msg.isCensored ? { fontStyle: 'italic', opacity: 0.8 } : undefined}
                  >
                    <span className="chat-wireframe-user">{msg.user}:</span> {msg.text}
                  </div>
                ))}
              </div>

              <form onSubmit={handleSendChat} className="chat-wireframe-form">
                <input
                  type="text"
                  placeholder="Type a message to chat..."
                  value={inputMsg}
                  onChange={(e) => setInputMsg(e.target.value)}
                />
                <button
                  type="submit"
                  className="mlp-cloud-btn secondary"
                  style={{ padding: '10px 20px' }}
                >
                  Send
                </button>
              </form>
            </>
          ) : (
            <div className="chat-locked-shield">
              <div style={{ fontSize: '42px' }}>🔒🛡️</div>
              <strong style={{ color: '#ffd700', fontSize: '16px' }}>
                Verified Duelists Only
              </strong>
              <p style={{ fontSize: '13px', color: '#e9d5ff', maxWidth: '300px', lineHeight: 1.5, margin: 0 }}>
                To protect younger players, Community Chat messages and posting are hidden until your account is verified and out of Safe Mode.
              </p>
            </div>
          )}
        </div>
      </div>

      {showDeckPickerModal && (
        <div className="hub-modal-backdrop" onClick={() => setShowDeckPickerModal(false)}>
          <div className="hub-picker-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 6px', color: '#ffd700', fontFamily: 'Nunito, sans-serif', fontWeight: 900, fontSize: '20px' }}>
              🃏 Select Your Active Deck
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#fbcfe8' }}>
              Choose any of your built decks or official starter decks for matchmaking and private rooms:
            </p>

            <div className="hub-picker-grid">
              {availableDecks.map((deck) => (
                <div
                  key={deck.id}
                  className={`hub-deck-option ${selectedDeck === deck.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedDeck(deck.id);
                    setShowDeckPickerModal(false);
                  }}
                >
                  <img
                    src={
                      deck.mane_image_url ||
                      'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/CardBack.webp'
                    }
                    alt={deck.name}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src =
                        'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/CardBack.webp';
                    }}
                  />
                  <strong style={{ fontSize: '13px', color: '#fffdf7' }}>{deck.name}</strong>
                  <span style={{ fontSize: '11px', color: '#ffd700', fontWeight: 800 }}>
                    {deck.element} {deck.is_starter ? '• Starter' : '• Custom'}
                  </span>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="mlp-cloud-btn secondary"
              onClick={() => setShowDeckPickerModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showQuickPlayStarterModal && (
        <div className="hub-modal-backdrop" onClick={() => setShowQuickPlayStarterModal(false)}>
          <div className="hub-picker-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 6px', color: '#ffd700', fontFamily: 'Nunito, sans-serif', fontWeight: 900, fontSize: '20px' }}>
              ⚡ Quick Play — Choose Your Starter Deck
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#fbcfe8' }}>
              Select which Mane 6 starter deck you want to pilot before entering the queue:
            </p>

            <div className="hub-picker-grid">
              {starterDecks.map((starter) => (
                <div
                  key={starter.id}
                  className={`hub-deck-option ${quickPlayStarterId === starter.id ? 'selected' : ''}`}
                  onClick={() => setQuickPlayStarterId(starter.id)}
                >
                  <img
                    src={
                      starter.mane_image_url ||
                      'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/CardBack.webp'
                    }
                    alt={starter.name}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src =
                        'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/CardBack.webp';
                    }}
                  />
                  <strong style={{ fontSize: '13px', color: '#fffdf7' }}>{starter.name}</strong>
                  <span style={{ fontSize: '11px', color: '#ffd700', fontWeight: 800 }}>
                    {starter.element}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="mlp-cloud-btn secondary"
                onClick={() => setShowQuickPlayStarterModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mlp-cloud-btn"
                style={{ width: 'auto', padding: '11px 28px', fontSize: '14.5px' }}
                onClick={() => {
                  setShowQuickPlayStarterModal(false);
                  queueWithDeck(quickPlayStarterId, 'Casual');
                }}
              >
                🚀 Launch Quick Play!
              </button>
            </div>
          </div>
        </div>
      )}

      {passwordPromptRoom && (
        <div className="hub-modal-backdrop" onClick={() => setPasswordPromptRoom(null)}>
          <div
            className="hub-picker-modal"
            style={{ maxWidth: '420px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 8px', color: '#ffd700' }}>
              🔒 Password Required
            </h3>
            <p style={{ fontSize: '13px', color: '#fbcfe8', marginBottom: '14px' }}>
              Enter the password for <strong>{passwordPromptRoom.room.name}</strong>:
            </p>
            <input
              type="password"
              className="hub-input"
              placeholder="Room password..."
              value={joinPasswordInput}
              onChange={(e) => setJoinPasswordInput(e.target.value)}
              style={{ marginBottom: '16px' }}
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="mlp-cloud-btn secondary"
                onClick={() => setPasswordPromptRoom(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mlp-cloud-btn"
                style={{ width: 'auto', padding: '10px 24px', fontSize: '14px' }}
                onClick={() => {
                  const target = passwordPromptRoom;
                  setPasswordPromptRoom(null);
                  executeRoomAction(target.room, target.action, joinPasswordInput);
                }}
              >
                Enter Match
              </button>
            </div>
          </div>
        </div>
      )}

      {isSearchingQueue && (
        <div className="hub-modal-backdrop" onClick={handleCancelQueue}>
          <div
            className="hub-picker-modal"
            style={{ textAlign: 'center', maxWidth: '420px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '36px', marginBottom: '10px' }}>✨🦄✨</div>
            <h3 style={{ color: '#ffd700', marginBottom: '8px', justifyContent: 'center' }}>
              Matchmaking in Progress
            </h3>
            <p style={{ fontSize: '14px', color: '#e9d5ff', marginBottom: '20px' }}>
              {queueStatusText}
            </p>
            <button type="button" className="mlp-cloud-btn secondary" onClick={handleCancelQueue}>
              Cancel &amp; Return
            </button>
          </div>
        </div>
      )}
    </div>
  );
}