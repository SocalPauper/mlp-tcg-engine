import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../context/AuthContext';

interface Card {
  id: string;
  cardNumber: string;
  name: string;
  type: string;
  rarity: string;
  set_code: string;
  traits: string;
  cost: number;
  power: number;
  defense: number;
  effectText: string;
  image_url?: string;
  imageUrl?: string;
}

interface Deck {
  id: string;
  name: string;
  author: string;
  isPublic: boolean;
  mane: Card | null;
  stories: Card[];
  scenes: Card[];
  main: Card[];
}

export default function DeckBuilder() {
  const { user } = useAuth();
  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'hub' | 'editor'>('hub');

  const [activeDeck, setActiveDeck] = useState<Deck>({
    id: '',
    name: 'New Custom Deck',
    author: user?.displayName || 'Player',
    isPublic: false,
    mane: null,
    stories: [],
    scenes: [],
    main: [],
  });

  const [activeTab, setActiveTab] = useState<'mane' | 'stories' | 'scenes' | 'main'>('mane');
  const [importExportText, setImportExportText] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);

  // Fetch cards and existing decks from backend API
  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE_URL}/api/cards`).then(async (res) => {
        const ct = res.headers.get('content-type');
        if (!ct || !ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      }).catch(() => []),
      fetch(`${API_BASE_URL}/api/decks`).then(async (res) => {
        const ct = res.headers.get('content-type');
        if (!ct || !ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      }).catch(() => [])
    ])
      .then(([cardsData, decksData]) => {
        setCards(Array.isArray(cardsData) ? cardsData : cardsData.cards || []);
        setDecks(Array.isArray(decksData) ? decksData : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load card catalog or decks:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: '#f472b6', background: '#111827', minHeight: '100vh', fontSize: '1.25rem', fontWeight: 'bold' }}>
        Loading Card Database & Decks...
      </div>
    );
  }

  // --- Strict Filtering Logic ---

  // 1. Mane Characters: strictly cards with rarity 'Mane' or type 'Mane' or starting with 'M' prefix in ID/set
  const maneCharacters = cards.filter(
    (c) => c.rarity?.toLowerCase() === 'mane' || c.type?.toLowerCase() === 'mane' || c.id?.startsWith('M')
  );

  // 2. Story Arcs: cards identified as stories (type Story or name contains Story)
  const storyCards = cards.filter(
    (c) => c.type?.toLowerCase() === 'story' || c.name?.toLowerCase().includes('story') || c.id?.startsWith('S')
  );

  const groupedStoryArcs: { [key: string]: Card[] } = {};
  storyCards.forEach((c) => {
    const arcKey = c.name.replace(/\b(1|2|3|4|I|II|III|IV|Part \d)\b/gi, '').trim();
    if (!groupedStoryArcs[arcKey]) groupedStoryArcs[arcKey] = [];
    if (!groupedStoryArcs[arcKey].some((existing) => existing.id === c.id)) {
      groupedStoryArcs[arcKey].push(c);
    }
  });

  // 3. Scene Cards: cards with type Scene or set code starting with ER
  const sceneCards = cards.filter(
    (c) => c.type?.toLowerCase() === 'scene' || c.set_code?.startsWith('ER') || c.id?.includes('ER')
  );

  // 4. Main Deck Card Pool: Exactly 50-card pool excluding Mane, Stories, and Scenes
  const getLegalMainDeckCards = () => {
    return cards.filter((c) => {
      const isMane = c.rarity?.toLowerCase() === 'mane' || c.type?.toLowerCase() === 'mane' || c.id?.startsWith('M');
      const isStory = c.type?.toLowerCase() === 'story' || c.name?.toLowerCase().includes('story') || c.id?.startsWith('S');
      const isScene = c.type?.toLowerCase() === 'scene' || c.set_code?.startsWith('ER') || c.id?.includes('ER');
      
      if (isMane || isStory || isScene) return false;

      // Optional trait matching against active Mane character if present
      if (!activeDeck.mane) return true;
      if (!activeDeck.mane.traits) return true;
      
      return c.traits?.split(', ').some((t) => activeDeck.mane?.traits?.includes(t));
    });
  };

  // --- Handlers ---
  const handleCreateNewDeck = () => {
    setActiveDeck({
      id: 'deck-' + Date.now(),
      name: 'My Custom Deck',
      author: user?.displayName || 'Player',
      isPublic: false,
      mane: null,
      stories: [],
      scenes: [],
      main: [],
    });
    setActiveTab('mane');
    setView('editor');
  };

  const handleEditDeck = (deck: Deck) => {
    setActiveDeck({ ...deck });
    setActiveTab('mane');
    setView('editor');
  };

  const handleSaveDeck = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/decks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeDeck),
      });
      if (!response.ok) throw new Error('Failed to save deck');
      const savedDeck = await response.json();

      const existingIndex = decks.findIndex((d) => d.id === savedDeck.id);
      if (existingIndex >= 0) {
        const updated = [...decks];
        updated[existingIndex] = savedDeck;
        setDecks(updated);
      } else {
        setDecks([...decks, savedDeck]);
      }
      setView('hub');
    } catch (err) {
      console.error('Error saving deck:', err);
      alert('Failed to save deck to database.');
    }
  };

  const handleExportDeck = () => {
    setImportExportText(JSON.stringify(activeDeck, null, 2));
    setShowImportModal(true);
  };

  const handleImportDeck = () => {
    try {
      const parsed = JSON.parse(importExportText);
      setActiveDeck(parsed);
      setShowImportModal(false);
      setView('editor');
    } catch (e) {
      alert('Invalid JSON format for deck import.');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#111827', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ background: '#1f2937', borderBottom: '1px solid #374151', padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, color: '#f472b6' }}>
            Equestria Clash TCG
          </h1>
          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>KAYOU MLP ONLINE ENGINE</span>
        </div>
        <div>
          {view === 'editor' && (
            <button
              onClick={() => setView('hub')}
              style={{ background: '#374151', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: '600', fontSize: '0.875rem' }}
            >
              ← Back to Deck Hub
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        {view === 'hub' ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ fontSize: '1.875rem', fontWeight: 'bold', margin: 0 }}>Deck Management Hub</h2>
                <p style={{ fontSize: '0.875rem', color: '#9ca3af', margin: '0.25rem 0 0 0' }}>
                  Browse community decks or build and manage your own custom configurations.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  onClick={handleCreateNewDeck}
                  style={{ background: 'linear-gradient(to right, #db2777, #9333ea)', color: '#fff', border: 'none', padding: '0.75rem 1.25rem', borderRadius: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  + Create New Deck
                </button>
                <button
                  onClick={() => {
                    setImportExportText('');
                    setShowImportModal(true);
                  }}
                  style={{ background: '#1f2937', color: '#fff', border: '1px solid #374151', padding: '0.75rem 1.25rem', borderRadius: '0.75rem', fontWeight: '600', cursor: 'pointer', fontSize: '0.875rem' }}
                >
                  Import Deck JSON
                </button>
              </div>
            </div>

            {decks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '4rem', background: '#1f2937', borderRadius: '1rem', border: '1px dashed #374151', color: '#9ca3af' }}>
                <p style={{ fontSize: '1rem', marginBottom: '1rem' }}>No decks found in the database. Click "+ Create New Deck" to get started!</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                {decks.map((deck) => (
                  <div
                    key={deck.id}
                    onClick={() => handleEditDeck(deck)}
                    style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '1rem', padding: '1.25rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#f472b6' }}>{deck.name}</h3>
                        <span style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '9999px', background: deck.isPublic ? '#065f46' : '#92400e', color: '#fff', fontWeight: 'bold' }}>
                          {deck.isPublic ? 'Public' : 'Private'}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#9ca3af', margin: '0 0 1rem 0' }}>Author: {deck.author}</p>
                      <div style={{ fontSize: '0.875rem', color: '#9ca3af', background: '#111827', padding: '0.75rem', borderRadius: '0.5rem' }}>
                        <div>Mane Character: {deck.mane ? deck.mane.name : 'None'}</div>
                        <div>Story Arcs: {deck.stories?.length > 0 ? '4 / 4' : '0 / 4'}</div>
                        <div>Scenes: {deck.scenes?.length || 0} / 15</div>
                        <div>Main Deck: {deck.main?.length || 0} / 50</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEditDeck(deck); }}
                        style={{ flex: 1, background: '#7c3aed', color: '#fff', border: 'none', padding: '0.5rem', borderRadius: '0.5rem', fontWeight: '600', cursor: 'pointer' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setActiveDeck(deck); handleExportDeck(); }}
                        style={{ background: '#374151', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', fontWeight: '600', cursor: 'pointer' }}
                      >
                        Export
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '2rem' }}>
            {/* Sidebar Editor Controls */}
            <div style={{ width: '300px', background: '#1f2937', border: '1px solid #374151', borderRadius: '1rem', padding: '1.25rem', height: 'fit-content' }}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 'bold' }}>DECK NAME</label>
                <input
                  type="text"
                  value={activeDeck.name}
                  onChange={(e) => setActiveDeck({ ...activeDeck, name: e.target.value })}
                  style={{ width: '100%', marginTop: '0.25rem', background: '#111827', border: '1px solid #374151', borderRadius: '0.5rem', padding: '0.5rem', color: '#fff', fontWeight: 'bold', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111827', padding: '0.5rem 0.75rem', borderRadius: '0.5rem' }}>
                <span style={{ fontSize: '0.875rem' }}>Visibility:</span>
                <button
                  onClick={() => setActiveDeck({ ...activeDeck, isPublic: !activeDeck.isPublic })}
                  style={{ background: activeDeck.isPublic ? '#059669' : '#d97706', color: '#fff', border: 'none', padding: '0.25rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  {activeDeck.isPublic ? 'Public' : 'Private'}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                <button
                  onClick={() => setActiveTab('mane')}
                  style={{ background: activeTab === 'mane' ? '#db2777' : '#111827', color: '#fff', border: 'none', padding: '0.75rem', borderRadius: '0.5rem', textAlign: 'left', fontWeight: '600', cursor: 'pointer' }}
                >
                  1. Mane Character ({activeDeck.mane ? '1' : '0'})
                </button>
                <button
                  onClick={() => setActiveTab('stories')}
                  style={{ background: activeTab === 'stories' ? '#db2777' : '#111827', color: '#fff', border: 'none', padding: '0.75rem', borderRadius: '0.5rem', textAlign: 'left', fontWeight: '600', cursor: 'pointer' }}
                >
                  2. Story Arcs ({activeDeck.stories?.length || 0}/4)
                </button>
                <button
                  onClick={() => setActiveTab('scenes')}
                  style={{ background: activeTab === 'scenes' ? '#db2777' : '#111827', color: '#fff', border: 'none', padding: '0.75rem', borderRadius: '0.5rem', textAlign: 'left', fontWeight: '600', cursor: 'pointer' }}
                >
                  3. Scene Cards ({activeDeck.scenes?.length || 0}/15)
                </button>
                <button
                  onClick={() => setActiveTab('main')}
                  style={{ background: activeTab === 'main' ? '#db2777' : '#111827', color: '#fff', border: 'none', padding: '0.75rem', borderRadius: '0.5rem', textAlign: 'left', fontWeight: '600', cursor: 'pointer' }}
                >
                  4. Card Pool ({activeDeck.main?.length || 0}/50)
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <button
                  onClick={handleSaveDeck}
                  style={{ background: '#059669', color: '#fff', border: 'none', padding: '0.75rem', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Save Deck
                </button>
                <button
                  onClick={handleExportDeck}
                  style={{ background: '#374151', color: '#fff', border: 'none', padding: '0.5rem', borderRadius: '0.5rem', fontWeight: '600', cursor: 'pointer', fontSize: '0.875rem' }}
                >
                  Export JSON
                </button>
              </div>
            </div>

            {/* Clickable Card Selection Grid */}
            <div style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: '1rem', padding: '1.5rem' }}>
              {activeTab === 'mane' && (
                <div>
                  <h3 style={{ marginTop: 0 }}>Choose Your Mane Character</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                    {(maneCharacters.length > 0 ? maneCharacters : cards).map((card) => (
                      <div
                        key={card.id}
                        onClick={() => setActiveDeck({ ...activeDeck, mane: card })}
                        style={{ background: '#111827', border: activeDeck.mane?.id === card.id ? '2px solid #db2777' : '1px solid #374151', borderRadius: '0.75rem', padding: '0.75rem', cursor: 'pointer' }}
                      >
                        <img 
                          src={card.image_url || card.imageUrl} 
                          alt={card.name} 
                          loading="lazy"
                          style={{ width: '100%', height: '220px', objectFit: 'cover', borderRadius: '0.5rem', background: '#374151' }}
                          onError={(e) => { e.currentTarget.src = 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/default-card-back.webp'; }}
                        />
                        <h4 style={{ fontSize: '0.875rem', margin: '0.5rem 0 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.name}</h4>
                        <p style={{ fontSize: '0.75rem', color: '#9ca3af', margin: '0.25rem 0 0 0' }}>Traits: {card.traits || 'None'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'stories' && (
                <div>
                  <h3 style={{ marginTop: 0 }}>Select a Story Arc (Set of 4)</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', marginTop: '1rem' }}>
                    {Object.entries(groupedStoryArcs).map(([arcName, arcCards]) => {
                      const isSelected = activeDeck.stories?.some((s) => arcCards.some((ac) => ac.id === s.id));
                      return (
                        <div
                          key={arcName}
                          onClick={() => setActiveDeck({ ...activeDeck, stories: isSelected ? [] : arcCards.slice(0, 4) })}
                          style={{ background: '#111827', border: isSelected ? '2px solid #db2777' : '1px solid #374151', borderRadius: '0.75rem', padding: '1rem', cursor: 'pointer' }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                            <span style={{ fontWeight: 'bold', color: '#f472b6', fontSize: '1rem' }}>{arcName} Arc</span>
                            <span style={{ fontSize: '0.75rem', background: isSelected ? '#db2777' : '#374151', padding: '0.25rem 0.75rem', borderRadius: '0.375rem', fontWeight: 'bold' }}>
                              {isSelected ? 'Selected (4/4)' : 'Click to Select Arc'}
                            </span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                            {arcCards.slice(0, 4).map((card) => (
                              <img 
                                key={card.id} 
                                src={card.image_url || card.imageUrl} 
                                alt={card.name} 
                                loading="lazy"
                                style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '0.375rem', background: '#374151' }}
                                onError={(e) => { e.currentTarget.src = 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/default-card-back.webp'; }}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === 'scenes' && (
                <div>
                  <h3 style={{ marginTop: 0 }}>Select Scene Cards ({activeDeck.scenes?.length || 0} / 15)</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                    {sceneCards.map((card) => {
                      const isSelected = activeDeck.scenes?.some((s) => s.id === card.id);
                      return (
                        <div
                          key={card.id}
                          onClick={() => {
                            if (isSelected) {
                              setActiveDeck({ ...activeDeck, scenes: activeDeck.scenes.filter((s) => s.id !== card.id) });
                            } else if ((activeDeck.scenes?.length || 0) < 15) {
                              setActiveDeck({ ...activeDeck, scenes: [...(activeDeck.scenes || []), card] });
                            }
                          }}
                          style={{ background: '#111827', border: isSelected ? '2px solid #db2777' : '1px solid #374151', borderRadius: '0.75rem', padding: '0.5rem', cursor: 'pointer', position: 'relative' }}
                        >
                          {isSelected && <span style={{ position: 'absolute', top: '10px', right: '10px', background: '#db2777', fontSize: '0.625rem', padding: '0.125rem 0.375rem', borderRadius: '0.25rem', fontWeight: 'bold', zIndex: 2 }}>Added</span>}
                          <img 
                            src={card.image_url || card.imageUrl} 
                            alt={card.name} 
                            loading="lazy"
                            style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '0.375rem', background: '#374151' }}
                            onError={(e) => { e.currentTarget.src = 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/default-card-back.webp'; }}
                          />
                          <h4 style={{ fontSize: '0.75rem', margin: '0.25rem 0 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.name}</h4>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === 'main' && (
                <div>
                  <h3 style={{ marginTop: 0 }}>50-Card Main Deck Pool ({activeDeck.main?.length || 0} / 50)</h3>
                  <p style={{ fontSize: '0.875rem', color: '#9ca3af' }}>Click any card to add it to your main deck (Mane, Stories, and Scenes are excluded).</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '1.5rem', marginTop: '1rem' }}>
                    {getLegalMainDeckCards().map((card) => {
                      const count = activeDeck.main?.filter((c) => c.id === card.id).length || 0;
                      return (
                        <div
                          key={card.id}
                          onClick={() => {
                            if ((activeDeck.main?.length || 0) < 50) {
                              setActiveDeck({ ...activeDeck, main: [...(activeDeck.main || []), card] });
                            }
                          }}
                          style={{ background: '#111827', border: count > 0 ? '2px solid #059669' : '1px solid #374151', borderRadius: '0.75rem', padding: '0.5rem', cursor: 'pointer', position: 'relative' }}
                        >
                          {count > 0 && <span style={{ position: 'absolute', top: '10px', right: '10px', background: '#059669', fontSize: '0.625rem', padding: '0.125rem 0.375rem', borderRadius: '0.25rem', fontWeight: 'bold', zIndex: 2 }}>x{count}</span>}
                          <img 
                            src={card.image_url || card.imageUrl} 
                            alt={card.name} 
                            loading="lazy"
                            style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '0.375rem', background: '#374151' }}
                            onError={(e) => { e.currentTarget.src = 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/default-card-back.webp'; }}
                          />
                          <h4 style={{ fontSize: '0.75rem', margin: '0.25rem 0 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.name}</h4>
                          <p style={{ fontSize: '0.675rem', color: '#9ca3af', margin: '0.25rem 0 0 0' }}>Cost: {card.cost} | {card.traits}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Import / Export Modal */}
      {showImportModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '1rem', padding: '1.5rem', width: '500px', maxWidth: '90%' }}>
            <h3 style={{ marginTop: 0 }}>Import / Export Deck JSON</h3>
            <textarea
              value={importExportText}
              onChange={(e) => setImportExportText(e.target.value)}
              rows={8}
              style={{ width: '100%', background: '#111827', border: '1px solid #374151', borderRadius: '0.5rem', padding: '0.75rem', color: '#4ade80', fontFamily: 'monospace', fontSize: '0.75rem', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button onClick={() => setShowImportModal(false)} style={{ background: '#374151', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleImportDeck} style={{ background: '#db2777', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer' }}>Import</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}