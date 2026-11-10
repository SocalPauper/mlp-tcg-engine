import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE_URL } from './config';
import Navbar from './components/Navbar';
import Home from './components/Home';
import DeckBuilder from './components/DeckBuilder';

axios.defaults.withCredentials = true;

interface User {
  id: number;
  username: string;
  email: string;
  displayName: string;
  isSafeMode: boolean;
  isVerified: boolean;
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
        if (data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
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
    if (data.user) {
      setUser(data.user);
    } else {
      setUser(data);
    }
  };

  const register = async (formData: any) => {
    const { data } = await axios.post(`${API_BASE_URL}/api/auth/register`, formData);
    if (data.user) {
      setUser(data.user);
    } else {
      setUser(data);
    }
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
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default function App() {
  const [currentView, setCurrentView] = useState<'home' | 'deckBuilder'>('home');

  return (
    <AuthProvider>
      <div className="app-root">
        <Navbar currentView={currentView} setCurrentView={setCurrentView} />
        <main className="app-content">
          {currentView === 'home' && <Home onStartDeckBuilder={() => setCurrentView('deckBuilder')} />}
          {currentView === 'deckBuilder' && <DeckBuilder />}
        </main>
      </div>
    </AuthProvider>
  );
}