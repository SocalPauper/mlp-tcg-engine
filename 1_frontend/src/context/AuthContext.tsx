import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

// Ensure axios sends cookies/credentials with every request
axios.defaults.withCredentials = true;

// Point directly to your live Render backend URL
axios.defaults.baseURL = 'https://mlp-tcg-engine.onrender.com';

interface User {
  id: number;
  username: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  register: (formData: { username: string; email: string; password: string }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Verify live session directly against your PostgreSQL backend on mount
  useEffect(() => {
    const verifyLiveSession = async () => {
      try {
        const { data } = await axios.get('/auth/verify');
        setUser(data.user || data);
      } catch (err) {
        // Verification failed (not logged in or session expired); ensure user is null, NOT safe mode
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    verifyLiveSession();
  }, []);

  const login = async (credentials: { email: string; password: string }) => {
    const { data } = await axios.post('/auth/login', credentials);
    setUser(data.user || data);
  };

  const register = async (formData: { username: string; email: string; password: string }) => {
    const { data } = await axios.post('/auth/register', formData);
    setUser(data.user || data);
  };

  const logout = async () => {
    try {
      await axios.post('/auth/logout');
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, register }}>
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