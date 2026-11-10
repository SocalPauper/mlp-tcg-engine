import React, { useState } from 'react';
import { useAuth } from '../App';
import BackgroundUploader from './BackgroundUploader';
import './MainHub.css';

interface GameLobby {
  id: string;
  name: string;
  host: string;
  status: 'Waiting' | 'In-Progress';
}

export default function MainHub() {
  const { user } = useAuth();
  const [lobbies, setLobbies] = useState<GameLobby[]>([
    { id: '1', name: 'Casual Mane 6 Showdown', host: 'TwilightFan99', status: 'Waiting' },
    { id: '2', name: 'Competitive Pauper Match', host: 'PauperMaster', status: 'In-Progress' }
  ]);
  const [newRoomName, setNewRoomName] = useState('');
  const [chatMessages, setChatMessages] = useState([
    { user: 'System', text: 'Welcome to the Equestria Clash General Chatroom!' }
  ]);
  const [inputMsg, setInputMsg] = useState('');

  const createGame = () => {
    if (!user) {
      alert('You must be logged in to create a game.');
      return;
    }
    if (!newRoomName) return;
    setLobbies([...lobbies, { id: Date.now().toString(), name: newRoomName, host: user.username, status: 'Waiting' }]);
    setNewRoomName('');
  };

  const sendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      alert('You must be logged in to chat.');
      return;
    }
    if (!inputMsg.trim()) return;
    setChatMessages([...chatMessages, { user: user.username, text: inputMsg }]);
    setInputMsg('');
  };

  return (
    <div className="hub-container" style={{ backgroundImage: `url(${localStorage.getItem('bg_hub') || ''})` }}>
      <BackgroundUploader tabKey="hub" />
      
      <div className="hub-grid">
        {/* Game Lobbies */}
        <div className="panel-box lobbies-panel">
          <h2>🎮 Game Lobbies</h2>
          {user && (
            <div className="create-room-box">
              <input 
                type="text" 
                placeholder="Room Name..." 
                value={newRoomName} 
                onChange={e => setNewRoomName(e.target.value)} 
              />
              <button onClick={createGame} className="mlp-btn">Create Game</button>
            </div>
          )}
          <div className="lobby-list">
            {lobbies.map(lobby => (
              <div key={lobby.id} className="lobby-card">
                <div>
                  <strong>{lobby.name}</strong>
                  <span>Host: {lobby.host} ({lobby.status})</span>
                </div>
                <div className="lobby-actions">
                  <button className="mlp-btn secondary">Join</button>
                  <button className="mlp-btn secondary">Spectate</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* General Chatroom */}
        <div className="panel-box chat-panel">
          <h2>💬 Authorized User Chatroom</h2>
          <div className="chat-messages">
            {chatMessages.map((msg, i) => (
              <div key={i} className="chat-msg">
                <span className="chat-username">{msg.user}:</span> {msg.text}
              </div>
            ))}
          </div>
          {user ? (
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
            <p className="auth-prompt-msg">Please log in to participate in the chatroom.</p>
          )}
        </div>
      </div>
    </div>
  );
}