import React, { createContext, useContext, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useSearchParams } from 'react-router-dom';
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

// Separate Verification Component to handle popup and token check via router
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
          login(updatedUser, localStorage.getItem('token') || 'dummy-jwt-token');
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
        <Routes>
          <Route path="/verify" element={<VerifyEmailRoute />} />
          <Route path="*" element={
            <>
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
            </>
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