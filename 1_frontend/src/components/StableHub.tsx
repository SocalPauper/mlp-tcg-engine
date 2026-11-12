import React, { useState, useEffect } from 'react';
import './StableHub.css';

// Using a simplified Deck interface for the grid display
export interface DeckSummary {
  id: string;
  name: string;
  author: string;
  element: string;
  mane_image_url: string;
  is_starter: boolean;
  is_public: boolean;
  card_count: number;
  owner_id: string; // Used to check if the current user can edit
}

interface StableHubProps {
  currentUserId: string;
  onOpenBuilder: (deckId: string | null, mode: 'CREATE' | 'EDIT' | 'VIEW' | 'COPY') => void;
}

export default function StableHub({ currentUserId, onOpenBuilder }: StableHubProps) {
  const [activeTab, setActiveTab] = useState<'MY_DECKS' | 'STARTERS' | 'COMMUNITY'>('MY_DECKS');
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(false);

  // In production, this useEffect will fetch from your '/api/decks' based on the active tab
  useEffect(() => {
    setLoading(true);
    // MOCK DATA: Replace with real fetch() to your PostgreSQL backend later
    setTimeout(() => {
      const mockDecks: DeckSummary[] = [
        { id: '1', name: 'Twilight Control', author: 'Jesse A.', element: 'Magic', mane_image_url: 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/SD01-C01.webp', is_starter: false, is_public: true, card_count: 70, owner_id: currentUserId },
        { id: '2', name: 'Applejack Beatdown', author: 'Equestria Games', element: 'Honesty', mane_image_url: 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/SD01-C04.webp', is_starter: true, is_public: true, card_count: 70, owner_id: 'admin' },
        { id: '3', name: 'Rainbow Rush', author: 'Wonderbolt_99', element: 'Loyalty', mane_image_url: 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/BP01-C05.webp', is_starter: false, is_public: true, card_count: 65, owner_id: 'user_456' },
      ];

      if (activeTab === 'MY_DECKS') {
        setDecks(mockDecks.filter(d => d.owner_id === currentUserId));
      } else if (activeTab === 'STARTERS') {
        setDecks(mockDecks.filter(d => d.is_starter));
      } else if (activeTab === 'COMMUNITY') {
        setDecks(mockDecks.filter(d => d.is_public && !d.is_starter));
      }
      setLoading(false);
    }, 400);
  }, [activeTab, currentUserId]);

  return (
    <div className="stable-hub-container">
      <div className="stable-header">
        <div>
          <h1>The Stable</h1>
          <span style={{ color: '#888', fontWeight: 600 }}>Your Deck Hub</span>
        </div>
        <button className="build-new-btn" onClick={() => onOpenBuilder(null, 'CREATE')}>
          Build New Deck ✦
        </button>
      </div>

      <div className="stable-tabs">
        <button 
          className={`stable-tab-btn ${activeTab === 'MY_DECKS' ? 'active' : ''}`}
          onClick={() => setActiveTab('MY_DECKS')}
        >
          My Decks
        </button>
        <button 
          className={`stable-tab-btn ${activeTab === 'STARTERS' ? 'active' : ''}`}
          onClick={() => setActiveTab('STARTERS')}
        >
          Starter Decks
        </button>
        <button 
          className={`stable-tab-btn ${activeTab === 'COMMUNITY' ? 'active' : ''}`}
          onClick={() => setActiveTab('COMMUNITY')}
        >
          Community Decks
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px', color: 'var(--mlp-purple)' }}>
          <strong>Loading the Stable... ✨</strong>
        </div>
      ) : (
        <div className="deck-grid">
          {decks.map(deck => {
            const isOwner = deck.owner_id === currentUserId;

            return (
              <div key={deck.id} className="deck-card">
                <div 
                  className="deck-card-banner" 
                  style={{ backgroundImage: `url(${deck.mane_image_url})` }}
                >
                  <div className="deck-card-element">{deck.element}</div>
                </div>
                
                <div className="deck-card-info">
                  <h3 className="deck-card-title">{deck.name}</h3>
                  <div className="deck-card-author">by {deck.author}</div>
                  
                  <div className="deck-card-stats">
                    <span>{deck.card_count} / 70 Cards</span>
                    {deck.is_starter && <span>★ Starter</span>}
                  </div>

                  <div className="deck-card-actions">
                    {isOwner && !deck.is_starter ? (
                      <button 
                        className="deck-action-btn btn-primary"
                        onClick={() => onOpenBuilder(deck.id, 'EDIT')}
                      >
                        Edit Deck
                      </button>
                    ) : (
                      <button 
                        className="deck-action-btn btn-secondary"
                        onClick={() => onOpenBuilder(deck.id, 'VIEW')}
                      >
                        View List
                      </button>
                    )}
                    
                    <button 
                      className="deck-action-btn btn-copy"
                      onClick={() => onOpenBuilder(deck.id, 'COPY')}
                    >
                      Copy to Mine
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {!loading && decks.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#888', padding: '40px' }}>
              No decks found in this category.
            </div>
          )}
        </div>
      )}
    </div>
  );
}