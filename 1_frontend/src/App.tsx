import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation, Link } from 'react-router-dom';
import DeckBuilder from './components/DeckBuilder.tsx';
import Signup from './components/Signup.tsx';
import Login from './components/Login.tsx';
import { VerifyEmail } from './components/VerifyEmail.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { API_BASE_URL } from './config';

function AppContent() {
  const { user, logout, isAuthenticated } = useAuth();
  const [currentTab, setCurrentTab] = useState<'lobby' | 'decks' | 'leaderboard' | 'community'>('decks');
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/site/announcement`)
      .then(res => res.json())
      .then(data => {
        if (data && data.message) setAnnouncement(data.message);
      })
      .catch((err) => {
        console.warn("Backend /api/site/announcement unreachable.", err);
      });
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#fdf4f8' }}>
      
      {announcement && (
        <div style={{ backgroundColor: '#db2777', color: 'white', padding: '8px 16px', textAlign: 'center', fontWeight: 800, fontSize: '0.85rem' }}>
          📢 {announcement}
        </div>
      )}

      {location.pathname !== '/verify' && (
        <header style={{ 
          background: 'linear-gradient(135deg, #1e1b4b, #3b0764, #581c87)', 
          padding: '16px 32px', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          borderBottom: '2px solid #7e22ce',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: 'linear-gradient(135deg, #f472b6, #9333ea)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', boxShadow: '0 0 10px #e879f9' }}>
              ✨
            </div>
            <div>
              <h1 style={{ color: 'white', fontSize: '1.2rem', fontWeight: 900, margin: 0, letterSpacing: '0.5px' }}>Equestria Clash TCG</h1>
              <span style={{ color: '#f0abfc', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>Kayou MLP Online Engine</span>
            </div>
          </div>

          <nav style={{ display: 'flex', gap: '8px', backgroundColor: 'rgba(255, 255, 255, 0.08)', padding: '6px', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.12)' }}>
            {[
              { id: 'lobby', label: 'Lobby' },
              { id: 'decks', label: 'Decks' },
              { id: 'leaderboard', label: 'Leaderboard' },
              { id: 'community', label: 'Community' },
            ].map((tab) => {
              const isActive = currentTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setCurrentTab(tab.id as any)}
                  style={{
                    backgroundColor: isActive ? '#ec4899' : 'transparent',
                    color: isActive ? 'white' : '#e7e5e4',
                    border: 'none',
                    padding: '8px 18px',
                    borderRadius: '12px',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: isActive ? '0 2px 8px rgba(236, 72, 153, 0.4)' : 'none'
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {isAuthenticated && user ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'rgba(255, 255, 255, 0.08)', padding: '6px 14px', borderRadius: '50px', border: '1px solid rgba(255, 255, 255, 0.12)' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: user.isSafeMode ? '#f59e0b' : '#10b981', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '0.75rem' }}>
                  {user.isSafeMode ? '🛡️' : '🔓'}
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ color: 'white', fontSize: '0.8rem', fontWeight: 700 }}>{user.displayName}</div>
                  <div style={{ color: '#f0abfc', fontSize: '0.65rem' }}>{user.isSafeMode ? 'Safe Mode' : 'Full Access'}</div>
                </div>
                <button
                  onClick={logout}
                  style={{ background: '#374151', color: 'white', border: 'none', padding: '4px 8px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', marginLeft: '6px' }}
                >
                  Logout
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Link to="/login" style={{ color: '#f0abfc', textDecoration: 'none', fontWeight: 'bold', fontSize: '0.85rem' }}>Sign In</Link>
                <Link to="/signup" style={{ background: '#ec4899', color: '#white', textDecoration: 'none', padding: '6px 14px', borderRadius: '8px', fontWeight: 'bold', fontSize: '0.85rem' }}>Register</Link>
              </div>
            )}
          </div>
        </header>
      )}

      <main style={{ flex: 1, padding: '24px 32px', maxWidth: '1400px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        <Routes>
          <Route 
            path="/" 
            element={
              !isAuthenticated ? (
                <Login />
              ) : currentTab === 'decks' ? (
                <DeckBuilder />
              ) : (
                <div style={{ backgroundColor: 'white', padding: '48px', borderRadius: '24px', textAlign: 'center', border: '1px solid #fbcfe8', color: '#57534e' }}>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#1c1917', marginBottom: '8px' }}>🚧 {currentTab.toUpperCase()} Module</h2>
                  <p style={{ margin: 0 }}>This section is fully integrated into your modular workspace architecture. Switch back to the <strong>Decks</strong> tab to manage your Kayou TCG build catalog.</p>
                </div>
              )
            } 
          />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/verify" element={<VerifyEmail />} />
        </Routes>
      </main>

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