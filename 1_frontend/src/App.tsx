import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from './config';
import Navbar from './components/Navbar';
import MainHub from './components/MainHub';
import GameBoard, { LiveGameState } from './components/GameBoard';
import StableHub from './components/StableHub';
import DeckBuilder from './components/DeckBuilder';
import CollectionBinder from './components/CollectionBinder';
import ShopView from './components/ShopView';
import RulesGlossaryTab from './components/RulesGlossaryTab';
import AdminPanel from './components/AdminPanel';
import AuthModal from './components/AuthModal';
import './index.css';

axios.defaults.withCredentials = true;

interface User {
  id: number;
  username: string;
  email: string;
  displayName: string;
  isSafeMode: boolean;
  isVerified: boolean;
  role?: string;
  reward_points?: number;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (credentials: { username: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  register: (formData: any) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const verifyLiveSession = async () => {
      const token = localStorage.getItem('token');
      try {
        const { data } = await axios.get(`${API_BASE_URL}/api/auth/me`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (data.user) setUser(data.user);
      } catch (err) {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    verifyLiveSession();
  }, []);

  const login = async (credentials: { username: string; password: string }) => {
    const { data } = await axios.post(`${API_BASE_URL}/api/auth/login`, credentials);
    if (data.token) {
      localStorage.setItem('token', data.token);
    }
    setUser(data.user || data);
  };

  const register = async (formData: any) => {
    const { data } = await axios.post(`${API_BASE_URL}/api/auth/register`, formData);
    if (data.token) {
      localStorage.setItem('token', data.token);
    }
    setUser(data.user || data);
  };

  const logout = async () => {
    try {
      await axios.post(`${API_BASE_URL}/api/auth/logout`);
    } finally {
      localStorage.removeItem('token');
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, loading, login, logout, register }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

type BuilderMode = 'CREATE' | 'EDIT' | 'VIEW' | 'COPY';

function VerifyEmailRoute() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [statusMessage, setStatusMessage] = useState('Verifying your email...');
  const [isSuccess, setIsSuccess] = useState(false);
  const { user, login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      setStatusMessage('Missing verification token.');
      return;
    }

    fetch(`${API_BASE_URL}/api/auth/verify?token=${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Verification failed.');
        
        setIsSuccess(true);
        setStatusMessage(data.message || 'Email verified successfully!');
        window.alert('Success! Your email has been verified and Safe Mode has been lifted.');

        if (user) {
          const updatedUser = { ...user, isSafeMode: false, isVerified: true };
          login(updatedUser as any);
        }

        setTimeout(() => navigate('/'), 2000);
      })
      .catch((err) => {
        setIsSuccess(false);
        setStatusMessage(err.message || 'An error occurred during verification.');
      });
  }, [token, navigate, user, login]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div style={{ background: '#1f2937', padding: '32px', borderRadius: '16px', width: '100%', maxWidth: '450px', color: '#fff', textAlign: 'center', border: '1px solid #374151' }}>
        <h2 style={{ marginBottom: '16px', color: isSuccess ? '#34d399' : '#f472b6' }}>Email Verification</h2>
        <p style={{ fontSize: '0.95rem', color: '#d1d5db' }}>{statusMessage}</p>
      </div>
    </div>
  );
}

const MATCH_SESSION_KEY = 'mlp_active_match_session';

function AppContent() {
  const [currentTab, setCurrentTab] = useState<string>('hub');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { user } = useAuth();

  const [builderConfig, setBuilderConfig] = useState<{ id: string | null, mode: BuilderMode } | null>(null);

  const [activeMatch, setActiveMatch] = useState<{
    ws: WebSocket;
    state: LiveGameState;
    seat: '0' | '1' | 'spectator';
    isReconnecting?: boolean;
  } | null>(null);

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalLeaveRef = useRef<boolean>(false);

  const attachMatchSocketHandlers = (
    ws: WebSocket,
    initialState: LiveGameState | null,
    seat: '0' | '1' | 'spectator'
  ) => {
    intentionalLeaveRef.current = false;

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, 20000);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'STATE_UPDATE' && data.state) {
          if (data.roomCode && data.sessionToken && (data.seat === '0' || data.seat === '1')) {
            sessionStorage.setItem(
              MATCH_SESSION_KEY,
              JSON.stringify({
                roomCode: data.roomCode,
                seat: data.seat,
                sessionToken: data.sessionToken,
              })
            );
          }

          setActiveMatch((prev) => ({
            ws,
            state: data.state,
            seat: data.seat || prev?.seat || seat,
            isReconnecting: false,
          }));
        } else if (data.type === 'RECONNECT_FAILED') {
          sessionStorage.removeItem(MATCH_SESSION_KEY);
          setActiveMatch(null);
        }
      } catch (err) {
        console.error('[MATCH WS ERROR]', err);
      }
    };

    ws.onclose = () => {
      clearInterval(pingInterval);
      if (intentionalLeaveRef.current) {
        sessionStorage.removeItem(MATCH_SESSION_KEY);
        setActiveMatch(null);
        return;
      }

      const savedRaw = sessionStorage.getItem(MATCH_SESSION_KEY);
      if (savedRaw) {
        setActiveMatch((prev) => (prev ? { ...prev, isReconnecting: true } : null));
        reconnectTimerRef.current = setTimeout(() => {
          try {
            const saved = JSON.parse(savedRaw);
            const wsUrl = API_BASE_URL.replace(/^http/, 'ws');
            const newSocket = new WebSocket(wsUrl);
            newSocket.onopen = () => {
              newSocket.send(
                JSON.stringify({
                  type: 'RECONNECT_MATCH',
                  roomCode: saved.roomCode,
                  seat: saved.seat,
                  sessionToken: saved.sessionToken,
                })
              );
            };
            attachMatchSocketHandlers(newSocket, null, saved.seat);
          } catch {
            sessionStorage.removeItem(MATCH_SESSION_KEY);
            setActiveMatch(null);
          }
        }, 1500);
      } else {
        setActiveMatch(null);
      }
    };

    if (initialState) {
      setActiveMatch({ ws, state: initialState, seat, isReconnecting: false });
    }
  };

  useEffect(() => {
    const savedRaw = sessionStorage.getItem(MATCH_SESSION_KEY);
    if (!savedRaw) return;
    try {
      const saved = JSON.parse(savedRaw);
      if (saved?.roomCode && saved?.sessionToken) {
        const wsUrl = API_BASE_URL.replace(/^http/, 'ws');
        const socket = new WebSocket(wsUrl);
        socket.onopen = () => {
          socket.send(
            JSON.stringify({
              type: 'RECONNECT_MATCH',
              roomCode: saved.roomCode,
              seat: saved.seat,
              sessionToken: saved.sessionToken,
            })
          );
        };
        attachMatchSocketHandlers(socket, null, saved.seat);
      }
    } catch {
      sessionStorage.removeItem(MATCH_SESSION_KEY);
    }
  }, []);

  const handleMatchJoined = (ws: WebSocket, initialState: LiveGameState, seat: '0' | '1' | 'spectator') => {
    if (initialState.roomId && (seat === '0' || seat === '1')) {
      const existing = sessionStorage.getItem(MATCH_SESSION_KEY);
      if (!existing) {
        sessionStorage.setItem(
          MATCH_SESSION_KEY,
          JSON.stringify({ roomCode: initialState.roomId, seat, sessionToken: '' })
        );
      }
    }
    attachMatchSocketHandlers(ws, initialState, seat);
  };

  const handleLeaveMatch = () => {
    intentionalLeaveRef.current = true;
    sessionStorage.removeItem(MATCH_SESSION_KEY);
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (activeMatch && activeMatch.ws.readyState === WebSocket.OPEN) {
      activeMatch.ws.close();
    }
    setActiveMatch(null);
  };

  const handleTabChange = (tab: string) => {
    if (activeMatch) {
      handleLeaveMatch();
    }
    setCurrentTab(tab);
    if (tab !== 'stable') {
      setBuilderConfig(null);
    }
  };

  return (
    <div className="app-container">
      {!activeMatch && (
        <Navbar currentTab={currentTab} setCurrentTab={handleTabChange} onOpenAuth={() => setShowAuthModal(true)} />
      )}

      <main className="main-content-area">
        <Routes>
          <Route path="/verify" element={<VerifyEmailRoute />} />
          <Route path="*" element={
            activeMatch ? (
              <GameBoard
                ws={activeMatch.ws}
                gameState={activeMatch.state}
                seat={activeMatch.seat}
                isReconnecting={activeMatch.isReconnecting}
                onLeaveMatch={handleLeaveMatch}
              />
            ) : (
              <>
                {currentTab === 'hub' && <MainHub onMatchJoined={handleMatchJoined} onNavigateTab={handleTabChange} />}
                {currentTab === 'stable' && (
                  builderConfig ? (
                    <DeckBuilder 
                      deckId={builderConfig.id} 
                      mode={builderConfig.mode}
                      onClose={() => setBuilderConfig(null)} 
                    />
                  ) : (
                    <StableHub 
                      currentUserId={user?.id?.toString() || ''} 
                      onOpenBuilder={(id, mode) => setBuilderConfig({ id, mode })} 
                    />
                  )
                )}
                {currentTab === 'collection' && (
                  <CollectionBinder onBackToStable={() => handleTabChange('stable')} />
                )}
                {currentTab === 'shop' && <ShopView />}
                {currentTab === 'community' && <div className="placeholder-tab"><h2>Community Decks Coming Soon</h2></div>}
                {currentTab === 'standings' && <div className="placeholder-tab"><h2>Tournament Standings Coming Soon</h2></div>}
                {currentTab === 'fanPage' && <div className="placeholder-tab"><h2>Fan Art & Lore Page Coming Soon</h2></div>}
                {currentTab === 'rules' && <RulesGlossaryTab />}
                {currentTab === 'admin' && <AdminPanel />}
              </>
            )
          } />
        </Routes>
      </main>

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}