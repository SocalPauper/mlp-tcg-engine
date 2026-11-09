import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';

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
  imageUrl: string;
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
  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'hub' | 'editor'>('hub');

  const [activeDeck, setActiveDeck] = useState<Deck>({
    id: '',
    name: 'New Custom Deck',
    author: 'Player',
    isPublic: false,
    mane: null,
    stories: [],
    scenes: [],
    main: [],
  });

  const [activeTab, setActiveTab] = useState<'mane' | 'stories' | 'scenes' | 'main'>('mane');
  const [importExportText, setImportExportText] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);

  // Fetch cards and existing decks from backend API with fallback sample catalog
  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE_URL}/api/cards`).then(async (res) => {
        const ct = res.headers.get('content-type');
        if (!ct || !ct.includes('application/json')) throw new Error('Not JSON');
        return res.json();
      }).catch(() => [
        { id: '1', cardNumber: 'M01', name: 'Twilight Sparkle, Element of Magic', type: 'Character', rarity: 'Mane', set_code: 'EQ', traits: 'Alicorn, Magic', cost: 0, power: 4, defense: 4, effectText: '', imageUrl: '' },
        { id: '2', cardNumber: 'M02', name: 'Applejack, Honest Worker', type: 'Character', rarity: 'Mane', set_code: 'EQ', traits: 'Earth Pony, Farm', cost: 0, power: 3, defense: 5, effectText: '', imageUrl: '' },
        { id: '3', cardNumber: 'S01', name: 'Friendship is Magic Story 1', type: 'Event', rarity: 'Common', set_code: 'EQ', traits: 'Friendship', cost: 1, power: 2, defense: 2, effectText: '', imageUrl: '' }
      ]),
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

  // --- Filtering Helpers ---
  const maneCharacters = cards.filter(
    (c) => c.type === 'Character' && (c.rarity === 'Mane' || c.id?.includes('Mane'))
  );

  const storyCards = cards.filter((c) => c.name?.toLowerCase().includes('story'));
  const groupedStoryArcs: { [key: string]: Card[] } = {};
  storyCards.forEach((c) => {
    const arcKey = c.name.replace(/\b(1|2|3|4|I|II|III|IV)\b/g, '').trim();
    if (!groupedStoryArcs[arcKey]) groupedStoryArcs[arcKey] = [];
    groupedStoryArcs[arcKey].push(c);
  });

  const sceneCards = cards.filter(
    (c) => c.type === 'Scene' || c.set_code?.startsWith('ER') || c.id?.includes('ER')
  );

  const getLegalMainDeckCards = () => {
    return cards.filter((c) => {
      if (c.type === 'Character' && (c.rarity === 'Mane' || c.id?.includes('Mane'))) return false;
      if (c.name?.toLowerCase().includes('story')) return false;
      if (c.type === 'Scene' || c.set_code?.startsWith('ER')) return false;
      if (!activeDeck.mane) return true;
      return c.traits?.split(', ').some((t) => activeDeck.mane?.traits?.includes(t));
    });
  };

  // --- Handlers ---
  const handleCreateNewDeck = () => {
    setActiveDeck({
      id: 'deck-' + Date.now(),
      name: 'My Custom Deck',
      author: 'Player',
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
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#9ca3af', margin: '0 0 1rem 0' }}>Author: {deck.author}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '2rem' }}>
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
              <button
                onClick={handleSaveDeck}
                style={{ width: '100%', background: '#059669', color: '#fff', border: 'none', padding: '0.75rem', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer' }}
              >
                Save Deck
              </button>
            </div>
            <div style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: '1rem', padding: '1.5rem' }}>
              <h3>Deck Builder Editor Active ({cards.length} cards available)</h3>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}