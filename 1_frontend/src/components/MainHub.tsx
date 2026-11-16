import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../App';
import { API_BASE_URL } from '../config';
import BackgroundUploader from './BackgroundUploader';
import { LiveGameState } from './GameBoard';
import './MainHub.css';

interface GameLobby {
  code: string;
  name: string;
  host: string;
  mode: 'Casual' | 'Ranked';
  status: 'Waiting' | 'In-Progress';
  allowSpectators: boolean;
  playerCount: number;
}

interface MainHubProps {
  onMatchJoined: (ws: WebSocket, state: LiveGameState, seat: '0' | '1' | 'spectator') => void;
}

export default function MainHub({ onMatchJoined }: MainHubProps) {
  const { user } = useAuth();
  const isGuest = !user;

  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [lobbies, setLobbies] = useState<GameLobby[]>([]);

  // Create Game Form Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [roomMode, setRoomMode] = useState<'Casual' | 'Ranked'>('Casual');
  const [allowSpectators, setAllowSpectators] = useState(true);

  // Quick Play Modal State
  const [showQuickPlayModal, setShowQuickPlayModal] = useState(false);
  const [selectedDeck, setSelectedDeck] = useState<string>(() => {
    return localStorage.getItem('mlp_last_deck_id') || 'SD01_TWILIGHT';
  });
  const [isSearchingQueue, setIsSearchingQueue] = useState(false);
  const [queueStatusText, setQueueStatusText] = useState('Searching for opponent in casual queue...');

  // Chat state
  const [chatMessages, setChatMessages] = useState([
    { user: 'System', text: isGuest ? 'Welcome Guest! You are in Guest Mode (Quick Play & Casual Rooms).' : 'Welcome to the Equestria Clash General Chatroom!' }
  ]);
  const [inputMsg, setInputMsg] = useState('');

  useEffect(() => {
    localStorage.setItem('mlp_last_deck_id', selectedDeck);
  }, [selectedDeck]);

  // Establish live WebSocket connection to Render backend
  useEffect(() => {
    const wsUrl = API_BASE_URL.replace(/^http/, 'ws');
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      setWsConnected(true);
      socket.send(JSON.stringify({ type: 'GET_ROOMS' }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'ROOMS_LIST') {
          setLobbies(data.rooms || []);
        } else if (data.type === 'QUEUED') {
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

    socket.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      // Only close socket if we didn't hand it off to an active match
      if (socket.readyState === WebSocket.OPEN && !isSearchingQueue) {
        // Keep socket alive if handed to GameBoard; App handles cleanup on leave
      }
    };
  }, []);

  const handleQuickPlayStart = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert('Connecting to game server... Please wait a moment and try again.');
      return;
    }

    setIsSearchingQueue(true);
    setQueueStatusText('Joining Quick Play queue...');
    wsRef.current.send(JSON.stringify({
      type: 'QUICK_PLAY',
      deckId: selectedDeck,
      username: user?.username || `Guest_${Math.floor(100 + Math.random() * 900)}`
    }));
  };

  const handleCancelQuickPlay = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'CANCEL_QUICK_PLAY' }));
    }
    setIsSearchingQueue(false);
    setShowQuickPlayModal(false);
  };

  const handleCreateGameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isGuest) {
      alert('Guests cannot create custom lobbies. Please use Quick Play or log in.');
      return;
    }
    if (!newRoomName.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'CREATE_ROOM',
      roomName: newRoomName.trim(),
      mode: roomMode,
      allowSpectators,
      deckId: selectedDeck,
      username: user?.username || 'Player'
    }));

    setNewRoomName('');
    setShowCreateModal(false);
  };

  const handleJoinRoom = (lobby: GameLobby) => {
    if (isGuest && lobby.mode === 'Ranked') {
      alert('Ranked matches require a registered account.');
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'JOIN_ROOM',
      roomCode: lobby.code,
      deckId: selectedDeck,
      username: user?.username || `Guest_${Math.floor(100 + Math.random() * 900)}`
    }));
  };

  const handleSpectateRoom = (lobby: GameLobby) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      type: 'SPECTATE_ROOM',
      roomCode: lobby.code
    }));
  };

  const sendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (isGuest) {
      alert('Guest mode restricted: Chat is reserved for registered users.');
      return;
    }
    if (!inputMsg.trim()) return;
    setChatMessages([...chatMessages, { user: user?.username || 'User', text: inputMsg }]);
    setInputMsg('');
  };

  return (
    <div className="hub-container" style={{ backgroundImage: `url(${localStorage.getItem('bg_hub') || ''})` }}>
      <BackgroundUploader tabKey="hub" />
      
      <div className="hub-grid">
        {/* Left Column: Quick Play & Active Lobbies */}
        <div className="hub-left-column">
          
          {/* Quick Play Hero Banner */}
          <div className="panel-box quick-play-banner" style={{ background: 'linear-gradient(135deg, #4c1d95, #831843)', marginBottom: '20px', textAlign: 'center', padding: '24px' }}>
            <div style={{ fontSize: '11px', color: wsConnected ? '#34d399' : '#fbbf24', marginBottom: '6px', fontWeight: 'bold' }}>
              {wsConnected ? '🟢 Live Matchmaking Server Connected' : '🟡 Connecting to Game Server...'}
            </div>
            <h1 style={{ color: '#fbcfe8', fontSize: '24px', marginBottom: '8px' }}>⚡ Instant Quick Play</h1>
            <p style={{ color: '#e9d5ff', fontSize: '13px', marginBottom: '16px' }}>
              {isGuest ? 'Playing as Guest: Jump instantly into casual matches with starter decks (No Pony Points awarded).' : 'Jump straight into casual matchmaking using your selected deck.'}
            </p>
            <button 
              onClick={() => setShowQuickPlayModal(true)} 
              className="mlp-btn"
              style={{ fontSize: '16px', padding: '12px 28px', background: 'linear-gradient(135deg, #ec4899, #f43f5e)' }}
            >
              🚀 Find Quick Play Match
            </button>
          </div>

          {/* Game Lobbies & Custom Matches */}
          <div className="panel-box lobbies-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h2>🎮 Custom Lobbies & Spectate</h2>
              {!isGuest ? (
                <button onClick={() => setShowCreateModal(true)} className="mlp-btn">Create Custom Game</button>
              ) : (
                <span style={{ fontSize: '11px', color: '#f472b6', fontStyle: 'italic' }}>Custom creation locked for Guests</span>
              )}
            </div>

            <div className="lobby-list">
              {lobbies.length === 0 ? (
                <p style={{ fontSize: '13px', color: '#d8b4fe', textAlign: 'center', padding: '16px 0' }}>
                  No active lobbies right now. Start a Quick Play match or create a custom room!
                </p>
              ) : (
                lobbies.map(lobby => (
                  <div key={lobby.code} className="lobby-card">
                    <div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <strong>{lobby.name}</strong>
                        <span className={`mode-badge ${lobby.mode.toLowerCase()}`}>{lobby.mode}</span>
                      </div>
                      <span style={{ fontSize: '12px', color: '#d8b4fe' }}>
                        Host: {lobby.host} • Players: {lobby.playerCount}/2 • Status: {lobby.status}
                      </span>
                    </div>
                    <div className="lobby-actions">
                      {lobby.playerCount < 2 && (
                        <button className="mlp-btn secondary" onClick={() => handleJoinRoom(lobby)}>
                          Join
                        </button>
                      )}
                      {lobby.allowSpectators ? (
                        <button className="mlp-btn secondary" onClick={() => handleSpectateRoom(lobby)}>
                          Spectate
                        </button>
                      ) : (
                        <span style={{ fontSize: '11px', color: '#9ca3af', alignSelf: 'center' }}>No Specs</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Chatroom */}
        <div className="panel-box chat-panel">
          <h2>💬 {isGuest ? 'Community Chat (Locked for Guests)' : 'Authorized User Chatroom'}</h2>
          <div className="chat-messages">
            {chatMessages.map((msg, i) => (
              <div key={i} className="chat-msg">
                <span className="chat-username">{msg.user}:</span> {msg.text}
              </div>
            ))}
          </div>
          {!isGuest ? (
            <form onSubmit={sendChatMessage} className="chat-form">
              <input 
                type="text" 
                placeholder="Type a message..." 
                value={inputMsg} 
                onChange={e => setInputMsg(e.target.value)} 
              />
              <button type="submit" className="mlp-btn">Send</button>
            </form>
          ) : (
            <p className="auth-prompt-msg">🔒 Guest Mode: Log in to chat, earn Pony Points, and unlock cards.</p>
          )}
        </div>
      </div>

      {/* Quick Play Deck Selection Modal */}
      {showQuickPlayModal && (
        <div className="auth-modal-overlay" onClick={() => !isSearchingQueue && setShowQuickPlayModal(false)}>
          <div className="auth-modal" onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
            <h2>⚡ Quick Play Matchmaking</h2>
            {isSearchingQueue ? (
              <div style={{ padding: '30px 0' }}>
                <div className="spinner" style={{ fontSize: '24px', marginBottom: '15px' }}>🌀</div>
                <p style={{ color: '#fbcfe8', fontWeight: 'bold' }}>{queueStatusText}</p>
                <p style={{ fontSize: '12px', color: '#d8b4fe', marginTop: '8px', marginBottom: '20px' }}>
                  Using Deck: {selectedDeck} {isGuest ? '(Guest Casual — No Pony Points)' : ''}
                </p>
                <button onClick={handleCancelQuickPlay} className="mlp-btn secondary">Cancel Search</button>
              </div>
            ) : (
              <>
                <p style={{ fontSize: '13px', color: '#d8b4fe', marginBottom: '15px' }}>Select your starter deck for this casual match:</p>
                <select 
                  value={selectedDeck} 
                  onChange={e => setSelectedDeck(e.target.value)}
                  style={{ width: '100%', padding: '12px', background: '#1e1124', color: '#fbcfe8', border: '1px solid #9333ea', borderRadius: '8px', marginBottom: '20px', fontWeight: 'bold' }}
                >
                  <option value="SD01_TWILIGHT">Twilight Sparkle Starter Deck (Magic)</option>
                  <option value="SD02_RAINBOW">Rainbow Dash Starter Deck (Loyalty)</option>
                </select>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={handleQuickPlayStart} className="mlp-btn" style={{ flex: 1, padding: '12px' }}>Start Match</button>
                  <button onClick={() => setShowQuickPlayModal(false)} className="mlp-btn secondary" style={{ flex: 1 }}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Create Custom Game Modal */}
      {showCreateModal && (
        <div className="auth-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="auth-modal" onClick={e => e.stopPropagation()}>
            <h2>🛠️ Create Custom Game Lobby</h2>
            <form onSubmit={handleCreateGameSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input 
                type="text" 
                placeholder="Room Name (e.g., Chill Pauper Game)" 
                value={newRoomName} 
                onChange={e => setNewRoomName(e.target.value)}
                required
              />
              <label style={{ fontSize: '13px', color: '#fbcfe8', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                Match Type:
                <select 
                  value={roomMode} 
                  onChange={e => setRoomMode(e.target.value as 'Casual' | 'Ranked')}
                  style={{ padding: '10px', background: '#1e1124', color: '#fbcfe8', border: '1px solid #9333ea', borderRadius: '8px' }}
                >
                  <option value="Casual">Casual (Practice & Fun)</option>
                  <option value="Ranked">Ranked (Competitive Ladder & MMR)</option>
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#fbcfe8', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={allowSpectators} 
                  onChange={e => setAllowSpectators(e.target.checked)} 
                />
                Allow Spectators
              </label>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="submit" className="mlp-btn" style={{ flex: 1, padding: '12px' }}>Create Room</button>
                <button type="button" onClick={() => setShowCreateModal(false)} className="mlp-btn secondary" style={{ flex: 1 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}