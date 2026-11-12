import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE_URL } from './config';
import Navbar from './components/Navbar';
import MainHub from './components/MainHub';
import StableHub from './components/StableHub';
import DeckBuilder from './components/DeckBuilder';
import AdminPanel from './components/AdminPanel';
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
      try {
        const { data } = await axios.get(`${API_BASE_URL}/api/auth/me`);
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
    setUser(data.user || data);
  };

  const register = async (formData: any) => {
    const { data } = await axios.post(`${API_BASE_URL}/api/auth/register`, formData);
    setUser(data.user || data);
  };

  const logout = async () => {
    try {
      await axios.post(`${API_BASE_URL}/api/auth/logout`);
    } finally {
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

function AppContent() {
  const [currentTab, setCurrentTab] = useState<string>('hub');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { user, login, register } = useAuth();

  // State to track if the DeckBuilder is open, and what deck it's editing
  const [builderConfig, setBuilderConfig] = useState<{ id: string | null, mode: BuilderMode } | null>(null);

  const handleTabChange = (tab: string) => {
    setCurrentTab(tab);
    // If they click away from the Stable tab, close the builder
    if (tab !== 'stable') {
      setBuilderConfig(null);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isRegisterMode) {
        await register({ username, password, email: `${username}@mlp.local`, displayName: username });
      } else {
        await login({ username, password });
      }
      setShowAuthModal(false);
      setUsername('');
      setPassword('');
    } catch (err) {
      alert('Authentication failed. Please check your credentials.');
    }
  };

  return (
    <div className="app-container">
      <Navbar currentTab={currentTab} setCurrentTab={handleTabChange} onOpenAuth={() => setShowAuthModal(true)} />

      <main className="main-content-area">
        {currentTab === 'hub' && <MainHub />}
        
        {/* Routing for The Stable vs Deck Builder */}
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

        {currentTab === 'community' && <div className="placeholder-tab"><h2>Community Decks Coming Soon</h2></div>}
        {currentTab === 'standings' && <div className="placeholder-tab"><h2>Tournament Standings Coming Soon</h2></div>}
        {currentTab === 'fanPage' && <div className="placeholder-tab"><h2>Fan Art & Lore Page Coming Soon</h2></div>}
        {currentTab === 'admin' && <AdminPanel />}
      </main>

      {/* Login / Registration Modal */}
      {showAuthModal && (
        <div className="auth-modal-overlay">
          <div className="auth-modal panel-box">
            <h2>{isRegisterMode ? 'Create Account' : 'Login to Equestria Clash'}</h2>
            <form onSubmit={handleAuthSubmit}>
              <input 
                type="text" 
                placeholder="Username" 
                value={username} 
                onChange={e => setUsername(e.target.value)} 
                required
              />
              <input 
                type="password" 
                placeholder="Password" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                required
              />
              <button type="submit" className="mlp-btn primary">
                {isRegisterMode ? 'Register' : 'Login'}
              </button>
            </form>
            <p className="toggle-auth-mode" onClick={() => setIsRegisterMode(!isRegisterMode)}>
              {isRegisterMode ? 'Already have an account? Login' : "Don't have an account? Register"}
            </p>
            <button onClick={() => setShowAuthModal(false)} className="mlp-btn secondary">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}