import React, { useState, useEffect } from 'react';
import DeckBuilder from './components/DeckBuilder.tsx';
import { API_BASE_URL } from './config';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'lobby' | 'decks' | 'leaderboard' | 'community'>('decks');
  const [announcement, setAnnouncement] = useState<string | null>(null);

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
      
      {/* Top Banner Announcement if configured */}
      {announcement && (
        <div style={{ backgroundColor: '#db2777', color: 'white', padding: '8px 16px', textAlign: 'center', fontWeight: 800, fontSize: '0.85rem' }}>
          📢 {announcement}
        </div>
      )}

      {/* Celestial Galaxy Navbar */}
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

        {/* Navigation Tabs */}
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

        {/* User Profile Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(255, 255, 255, 0.08)', padding: '6px 14px 6px 6px', borderRadius: '50px', border: '1px solid rgba(255, 255, 255, 0.12)' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#ec4899', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '0.8rem' }}>
            JA
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: 'white', fontSize: '0.8rem', fontWeight: 800, lineHeight: 1.1 }}>Jesse Alvarez</span>
            <span style={{ color: '#f472b6', fontSize: '0.65rem', fontWeight: 700 }}>Administrator</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '24px 32px', maxWidth: '1400px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {currentTab === 'decks' ? (
          <DeckBuilder />
        ) : (
          <div style={{ backgroundColor: 'white', padding: '48px', borderRadius: '24px', textAlign: 'center', border: '1px solid #fbcfe8', color: '#57534e' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#1c1917', marginBottom: '8px' }}>🚧 {currentTab.toUpperCase()} Module</h2>
            <p style={{ margin: 0 }}>This section is fully integrated into your modular workspace architecture. Switch back to the <strong>Decks</strong> tab to manage your Kayou TCG build catalog.</p>
          </div>
        )}
      </main>

    </div>
  );
}