import React, { useState, useEffect } from 'react';
import './StableHub.css';

export interface DeckSummary {
  id: string;
  name: string;
  author: string;
  element: string;
  mane_character: string | null;
  mane_image_url: string;
  is_starter: boolean;
  is_public: boolean;
  card_count: number;
  owner_id?: string;
}

interface StableHubProps {
  currentUserId: string;
  onOpenBuilder: (deckId: string | null, mode: 'CREATE' | 'EDIT' | 'VIEW' | 'COPY') => void;
}

const API_BASE = 'https://mlp-tcg-engine.onrender.com';

export default function StableHub({ currentUserId, onOpenBuilder }: StableHubProps) {
  const [activeTab, setActiveTab] = useState<'MY_DECKS' | 'STARTERS' | 'COMMUNITY'>('MY_DECKS');
  const [allDecks, setAllDecks] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDecks = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const [decksRes, cardsRes] = await Promise.all([
        fetch(`${API_BASE}/api/decks`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        }),
        fetch(`${API_BASE}/api/cards`)
      ]);

      const rawDecks = decksRes.ok ? await decksRes.json() : [];
      const cards = cardsRes.ok ? await cardsRes.json() : [];
      const cardMap = new Map<string, any>(
        Array.isArray(cards) ? cards.map((c: any) => [String(c.id).toLowerCase(), c]) : []
      );

      const mapped: DeckSummary[] = (Array.isArray(rawDecks) ? rawDecks : []).map((d: any) => {
        const maneId = d.mane_character ? String(d.mane_character).toLowerCase() : '';
        const maneCard = maneId ? cardMap.get(maneId) : null;

        const storyCount = Array.isArray(d.story_deck) ? d.story_deck.length : 0;
        const sceneCount = Array.isArray(d.scene_deck) ? d.scene_deck.length : 0;
        const mainCount = Array.isArray(d.main_deck) ? d.main_deck.length : 0;
        const totalCount = (d.mane_character ? 1 : 0) + storyCount + sceneCount + mainCount;

        return {
          id: d.id,
          name: d.name || 'Untitled Deck',
          author: d.author || 'Player',
          element: d.element || maneCard?.element || 'Unaligned',
          mane_character: d.mane_character || null,
          mane_image_url:
            maneCard?.image_url ||
            'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/SD01-C01.webp',
          is_starter: Boolean(d.is_starter || String(d.id).startsWith('starter-')),
          is_public: d.is_public ?? true,
          card_count: totalCount,
          owner_id: d.user_id || d.owner_id || currentUserId,
        };
      });

      setAllDecks(mapped);
    } catch (err) {
      console.error('Failed to load decks in StableHub:', err);
      setAllDecks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDecks();
  }, [currentUserId]);

  const handleDeleteDeck = async (deckId: string, deckName: string) => {
    if (!window.confirm(`Are you sure you want to delete "${deckName}"?`)) return;

    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE}/api/decks/${deckId}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error('Delete failed');
      setAllDecks(prev => prev.filter(d => d.id !== deckId));
    } catch (err) {
      console.error('Error deleting deck:', err);
      alert('Failed to delete deck.');
    }
  };

  const filteredDecks = allDecks.filter(deck => {
    if (activeTab === 'STARTERS') {
      return deck.is_starter;
    }
    if (activeTab === 'COMMUNITY') {
      return deck.is_public && !deck.is_starter;
    }
    // MY_DECKS: includes all 6 starter decks + the player's own custom decks
    const isMine =
      deck.is_starter ||
      !deck.owner_id ||
      deck.owner_id === currentUserId;
    return isMine;
  });

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
          Starter Decks (6)
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
          {filteredDecks.map(deck => {
            const isEditable = !deck.is_starter && (!deck.owner_id || deck.owner_id === currentUserId);

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
                    {isEditable ? (
                      <>
                        <button 
                          className="deck-action-btn btn-primary"
                          onClick={() => onOpenBuilder(deck.id, 'EDIT')}
                        >
                          Edit
                        </button>
                        <button 
                          className="deck-action-btn btn-copy"
                          onClick={() => onOpenBuilder(deck.id, 'COPY')}
                        >
                          Copy
                        </button>
                        <button 
                          className="deck-action-btn btn-danger"
                          onClick={() => handleDeleteDeck(deck.id, deck.name)}
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <>
                        <button 
                          className="deck-action-btn btn-secondary"
                          onClick={() => onOpenBuilder(deck.id, 'VIEW')}
                        >
                          View List
                        </button>
                        <button 
                          className="deck-action-btn btn-copy"
                          onClick={() => onOpenBuilder(deck.id, 'COPY')}
                        >
                          Copy to Mine
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {!loading && filteredDecks.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#888', padding: '40px' }}>
              No decks found in this category.
            </div>
          )}
        </div>
      )}
    </div>
  );
}