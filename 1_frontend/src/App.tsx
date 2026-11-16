import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE_URL } from './config';
import Navbar from './components/Navbar';
import MainHub from './components/MainHub';
import StableHub from './components/StableHub';
import DeckBuilder from './components/DeckBuilder';
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

function AppContent() {
  const [currentTab, setCurrentTab] = useState<string>('hub');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { user } = useAuth();

  const [builderConfig, setBuilderConfig] = useState<{ id: string | null, mode: BuilderMode } | null>(null);

  const handleTabChange = (tab: string) => {
    setCurrentTab(tab);
    if (tab !== 'stable') {
      setBuilderConfig(null);
    }
  };

  return (
    <div className="app-container">
      <Navbar currentTab={currentTab} setCurrentTab={handleTabChange} onOpenAuth={() => setShowAuthModal(true)} />

      <main className="main-content-area">
        {currentTab === 'hub' && <MainHub />}
        
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

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
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