import React, { useState, useEffect, useRef } from 'react';
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

interface MainHubProps {
  onMatchJoined: (ws: WebSocket, state: LiveGameState, seat: '0' | '1' | 'spectator') => void;
  onNavigateTab?: (tab: string) => void;
}

const FALLBACK_STARTERS: SelectableDeck[] = [
  { id: 'starter-sd01', name: 'Twilight Sparkle - Magic Starter', element: 'Magic', is_starter: true },
  { id: 'starter-sd02', name: 'Rainbow Dash - Loyalty Starter', element: 'Loyalty', is_starter: true },
  { id: 'starter-sd03', name: 'Applejack - Honesty Starter', element: 'Honesty', is_starter: true },
  { id: 'starter-sd04', name: 'Rarity - Generosity Starter', element: 'Generosity', is_starter: true },
  { id: 'starter-sd05', name: 'Fluttershy - Kindness Starter', element: 'Kindness', is_starter: true },
  { id: 'starter-sd06', name: 'Pinkie Pie - Laughter Starter', element: 'Laughter', is_starter: true },
];

export default function MainHub({ onMatchJoined, onNavigateTab }: MainHubProps) {
  const { user } = useAuth();
  const isGuest = !user;

  // Age gated and verified non-safemode conditions
  const isSafeMode = user?.isSafeMode ?? true;
  const canChat = user && !isSafeMode && (user.isVerified || user.role === 'admin');

  const wsRef = useRef<WebSocket | null>(null);
  const [availableDecks, setAvailableDecks] = useState<SelectableDeck[]>(FALLBACK_STARTERS);

  // Matchmaking State
  const [matchMode, setMatchMode] = useState<'Casual' | 'Ranked'>('Casual');
  const [selectedDeck, setSelectedDeck] = useState<string>(() => {
    const saved = localStorage.getItem('mlp_last_deck_id');
    return saved && saved.startsWith('starter-sd') ? saved : 'starter-sd01';
  });

  // Quick Play Modal / Queue state
  const [showQuickPlayModal, setShowQuickPlayModal] = useState(false);
  const [isSearchingQueue, setIsSearchingQueue] = useState(false);
  const [queueStatusText, setQueueStatusText] = useState('Searching for opponent...');

  // Chat state with customized fallback for restricted/safemode accounts
  const [chatMessages, setChatMessages] = useState([
    {
      user: 'System',
      text: canChat
        ? 'Welcome to the Equestria Clash chat, verified duelist! Share your latest strategies!'
        : 'Notice: Out of abundance of safety, only non-guest accounts and those verified to be older than 13 participate here. Please explore of our News Feed updates or find a Match!',
    },
    { user: 'Princess Celestia', text: 'Peace and harmony to all our duelists! ✨ Let your card play shine today!' },
  ]);
  const [inputMsg, setInputMsg] = useState('');

  // Live admin theme and overlay properties
  const customBgUrl = localStorage.getItem('bg_hub') || '';
  const bgOpacity = Number(localStorage.getItem('bg_hub_opacity') || '1');

  useEffect(() => {
    localStorage.setItem('mlp_last_deck_id', selectedDeck);
  }, [selectedDeck]);

  // Fetch user decks or default starters
  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`${API_BASE_URL}/api/decks`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: any[]) => {
        if (!Array.isArray(data) || data.length === 0) return;
        const mapped: SelectableDeck[] = data.map((d) => ({
          id: d.id,
          name: d.name,
          element: d.element || 'Unaligned',
          is_starter: Boolean(d.is_starter || String(d.id).startsWith('starter-')),
          mane_image_url: d.mane_image_url || null,
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

  // WebSocket for matchmaking
  useEffect(() => {
    const wsUrl = API_BASE_URL.replace(/^http/, 'ws');
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'QUEUED') {
          setQueueStatusText(data.message || 'Waiting for opponent...');
        } else if (data.type === 'STATE_UPDATE' && data.state) {
          setIsSearchingQueue(false);
          setShowQuickPlayModal(false);
          onMatchJoined(socket, data.state, data.seat);
        } else if (data.type === 'ERROR') {
          setIsSearchingQueue(false);
          alert(data.message || 'Matchmaking error');
        }
      } catch (err) {
        console.error('[WS PARSE ERROR]', err);
      }
    };
  }, []);

  const handleStartMatch = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert('Connecting to game server... Please try again.');
      return;
    }
    setIsSearchingQueue(true);
    setQueueStatusText(`Joining ${matchMode} queue...`);
    wsRef.current.send(
      JSON.stringify({
        type: 'QUICK_PLAY',
        deckId: selectedDeck,
        mode: matchMode,
        username: user?.displayName || user?.username || `Pony_${Math.floor(100 + Math.random() * 900)}`,
      })
    );
  };

  const handleCancelQueue = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'CANCEL_QUICK_PLAY' }));
    }
    setIsSearchingQueue(false);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canChat) {
      alert('Your account must be verified and non-safemode to type here.');
      return;
    }
    if (!inputMsg.trim()) return;
    setChatMessages([...chatMessages, { user: user?.displayName || user?.username || 'You', text: inputMsg }]);
    setInputMsg('');
  };

  const currentDeckObj = availableDecks.find((d) => d.id === selectedDeck);

  return (
    <div
      className="hub-container"
      style={{
        backgroundImage: customBgUrl ? `url(${customBgUrl})` : undefined,
        backgroundBlendMode: customBgUrl ? 'overlay' : undefined,
      }}
    >
      {/* Background Opacity Overlay Layer controlled by admin config */}
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

      <div className="hub-wireframe-layout" style={{ position: 'relative', zIndex: 4 }}>
        
        {/* TOP LEFT CLUSTER: Matchmaking UI */}
        <div className="hub-top-left-cluster">
          <div className="cloud-panel">
            <h3>☁️ Matchmaking Control Center</h3>
            
            <div className="matchmaking-grid">
              {/* Match Type Box (Casual / Ranked) */}
              <div className="match-subbox">
                <span style={{ fontSize: '13px', fontWeight: 900, color: '#ff9ebb', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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
                    Ranked
                  </label>
                </div>
              </div>

              {/* Selected Deck Box with redirect capabilities to Stable */}
              <div className="match-subbox">
                <span style={{ fontSize: '13px', fontWeight: 900, color: '#ff9ebb', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Selected Deck
                </span>
                <div className="deck-select-inner">
                  <div className="deck-current-name">
                    {currentDeckObj ? `${currentDeckObj.name}` : 'Default Starter'}
                  </div>
                  {onNavigateTab && (
                    <button className="mlp-cloud-btn secondary" onClick={() => onNavigateTab('stable')}>
                      Deck Select ⚙️
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* START Match Button */}
            <button className="mlp-cloud-btn" onClick={handleStartMatch}>
              ✨ START {matchMode.toUpperCase()} MATCH ✨
            </button>
          </div>

          {/* QUICK PLAY MODULE */}
          <div className="cloud-panel quick-play-module">
            <h3 style={{ marginBottom: '8px', color: '#fffdf7' }}>⚡ Quick Play (Starter Decks Only)</h3>
            <p style={{ fontSize: '14px', color: '#fce7f3', marginBottom: '18px', maxWidth: '480px' }}>
              Jump straight into a fast-paced magical duel using any of the official Mane 6 starter decks!
            </p>
            <button
              className="mlp-cloud-btn"
              style={{ maxWidth: '290px', padding: '12px 28px', fontSize: '15px' }}
              onClick={() => {
                setShowQuickPlayModal(true);
                handleStartMatch();
              }}
            >
              Quick Play Now 🚀
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: Chatroom gated based on Account and Safety checks */}
        <div className="cloud-panel chat-wireframe-panel">
          <div>
            <h3>💬 Equestrian Community Chat</h3>
            <p style={{ fontSize: '12px', color: '#fbcfe8', lineHeight: '1.45', margin: '8px 0 14px' }}>
              {canChat
                ? 'Authorized chat is active. Communicate freely with fellow card duelists!'
                : 'Locked Chat Area. Out of abundance of safety, only non-guest accounts, and accounts verified as over the age of 13 can participate.'}
            </p>
          </div>

          <div className="chat-wireframe-messages">
            {chatMessages.map((msg, i) => (
              <div key={i} className="chat-wireframe-msg">
                <span className="chat-wireframe-user">{msg.user}:</span> {msg.text}
              </div>
            ))}
          </div>

          {canChat ? (
            <form onSubmit={handleSendChat} className="chat-wireframe-form">
              <input
                type="text"
                placeholder="Type a message to chat..."
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
              />
              <button type="submit" className="mlp-cloud-btn secondary" style={{ padding: '10px 20px' }}>
                Send
              </button>
            </form>
          ) : (
            <div style={{ fontSize: '12px', color: '#ff85a2', fontStyle: 'italic', textAlign: 'center', padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '16px' }}>
              🔒 Chat is locked in Safe Mode / Guest Mode.
            </div>
          )}
        </div>

        {/* BOTTOM ROW: Leaderboard & News Feed */}
        <div className="hub-bottom-row">
          
          {/* Top 10 Player Leaderboard */}
          <div className="cloud-panel bottom-module-card">
            <h3>🏆 Top 10 Player Leaderboard</h3>
            <div className="leaderboard-list">
              <div className="leaderboard-row">
                <span>1. 🌟 TwilightSparkle99</span>
                <span><strong>2,450 MMR</strong></span>
              </div>
              <div className="leaderboard-row">
                <span>2. ⚡ DashieFast</span>
                <span><strong>2,380 MMR</strong></span>
              </div>
              <div className="leaderboard-row">
                <span>3. 🍎 AppleBucks</span>
                <span><strong>2,210 MMR</strong></span>
              </div>
              <div className="leaderboard-row">
                <span>4. 🎨 RarityBoutique</span>
                <span><strong>2,150 MMR</strong></span>
              </div>
              <div className="leaderboard-row">
                <span>5. 🦋 Flutter Sanctuary</span>
                <span><strong>2,090 MMR</strong></span>
              </div>
            </div>
          </div>

          {/* Kayou MLP TCG News Feed */}
          <div className="cloud-panel bottom-module-card">
            <h3>📜 Kayou MLP TCG News Feed</h3>
            <div className="news-item">
              <div className="news-title">BP04 Hearth’s Warming Expansion Live!</div>
              <p className="news-snippet">Present unwrapping mechanics and new CMCs are now fully playable in online matches.</p>
            </div>
            <div className="news-item">
              <div className="news-title">SoCal Pauper Championship Announced</div>
              <p className="news-snippet">Check socalpauper.com for upcoming local tournaments across Southern California!</p>
            </div>
          </div>

        </div>

      </div>

      {/* Quick Play Queue Modal */}
      {showQuickPlayModal && isSearchingQueue && (
        <div className="auth-modal-overlay" onClick={handleCancelQueue}>
          <div className="auth-modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', maxWidth: '420px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>✨🦄✨</div>
            <h3 style={{ color: '#fbcfe8', marginBottom: '8px' }}>Matchmaking in Progress</h3>
            <p style={{ fontSize: '14px', color: '#e9d5ff', marginBottom: '20px' }}>{queueStatusText}</p>
            <button className="mlp-cloud-btn secondary" onClick={handleCancelQueue}>
              Cancel & Return
            </button>
          </div>
        </div>
      )}
    </div>
  );
}