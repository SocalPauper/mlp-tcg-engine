import React, { useState, useEffect, useMemo } from 'react';

const MAX_DECK_SIZE = 50;
const MAX_COPIES_PER_CARD = 3;

interface Card {
  id: string | number;
  name: string;
  type?: string; 
  element?: string;
  imageUrl?: string;
  cardNumber?: string;
}

interface Deck {
  id: string | number;
  name: string;
  author: string;
  authorId: string;
  maneCharacter: Card | null;
  cards: Card[];
  scenes: Card[];
  stories: Card[];
}

export default function DeckBuilder() {
  const currentUser = 'Jesse Alvarez'; 
  const [viewMode, setViewMode] = useState<'hub' | 'editor'>('hub');
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [catalogCards, setCatalogCards] = useState<Card[]>([]);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('Leader / Mane Character');
  const [engineStatus, setEngineStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Leader identification via ID patterns (-001 starter flagships, -RR, -CR, -GR)
  const isLeaderCard = (card: Card) => {
    const id = String(card.id || card.cardNumber || '').toUpperCase();
    const isStarterFlagship = /-001$/.test(id);
    const isLeaderRarity = id.includes('-RR') || id.includes('-CR') || id.includes('-GR');
    const typeStr = (card.type || '').toLowerCase();
    const explicitLeaderType = typeStr.includes('leader') || typeStr.includes('main character');

    return isStarterFlagship || isLeaderRarity || explicitLeaderType;
  };

  const isSceneCard = (typeStr: string = '') => {
    return typeStr.toLowerCase().includes('scene');
  };

  const isStoryCard = (typeStr: string = '') => {
    return typeStr.toLowerCase().includes('story');
  };

  useEffect(() => {
    fetch('http://localhost:3001/api/decks')
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => {
        if (Array.isArray(data)) {
          const normalized = data.map(d => ({
            ...d,
            scenes: d.scenes || [],
            stories: d.stories || []
          }));
          setDecks(normalized);
        }
      })
      .catch(() => {
        const saved = localStorage.getItem('socal_mlp_decks');
        if (saved) setDecks(JSON.parse(saved));
      });

    fetch('http://localhost:3001/api/cards')
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => {
        if (Array.isArray(data)) {
          setCatalogCards(data);
          setTypeFilter('Leader / Mane Character');
        }
      })
      .catch(() => console.warn('Backend /api/cards unreachable.'));
  }, []);

  const saveDecksToStorage = (updatedDecks: Deck[]) => {
    setDecks(updatedDecks);
    localStorage.setItem('socal_mlp_decks', JSON.stringify(updatedDecks));
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 3000);
  };

  const handleCreateNewDeck = () => {
    const newDeck: Deck = { 
      id: 'deck-' + Date.now(), 
      name: 'New Custom Deck', 
      author: currentUser, 
      authorId: currentUser, 
      maneCharacter: null,
      cards: [],
      scenes: [],
      stories: []
    };
    saveDecksToStorage([newDeck, ...decks]);
    setSelectedDeck(newDeck);
    setViewMode('editor');
    
    setTypeFilter('Leader / Mane Character');
    setEngineStatus('New deck created! Please select your Mane Character Leader first.');
    setTimeout(() => setEngineStatus(null), 4500);
  };

  const handleDeleteDeck = (deckId: string | number) => {
    if (!confirm('Are you sure you want to delete this deck?')) return;
    const updatedList = decks.filter(d => d.id !== deckId);
    saveDecksToStorage(updatedList);
    if (selectedDeck?.id === deckId) setViewMode('hub');
  };

  const handleSaveDeck = () => {
    if (!selectedDeck) return;
    if (!selectedDeck.maneCharacter) return showError('Deck must have a Mane Character leader!');
    if (selectedDeck.cards.length !== MAX_DECK_SIZE) return showError(`Main deck must contain exactly ${MAX_DECK_SIZE} cards.`);

    const updatedList = decks.map(d => d.id === selectedDeck.id ? selectedDeck : d);
    saveDecksToStorage(updatedList);
    setEngineStatus(`Successfully saved "${selectedDeck.name}"!`);
    setTimeout(() => setEngineStatus(null), 3000);
  };

  const handleAddCard = (card: Card) => {
    if (!selectedDeck) return;
    
    // 1. Assigning or Changing the Leader
    if (!selectedDeck.maneCharacter) {
      if (!isLeaderCard(card)) {
        return showError('You must select a valid Mane Character leader card first!');
      }
      setSelectedDeck({ ...selectedDeck, maneCharacter: card, cards: [] });
      setTypeFilter('All');
      setEngineStatus(`Assigned ${card.name} as Mane Leader! Deck building unlocked.`);
      setTimeout(() => setEngineStatus(null), 2500);
      return;
    }

    if (isLeaderCard(card)) {
      if (confirm(`Change Mane Leader to ${card.name}? (Note: This will reset your current main deck elements if identities differ).`)) {
        setSelectedDeck({ ...selectedDeck, maneCharacter: card });
        setEngineStatus(`Updated Mane Leader to ${card.name}!`);
        setTimeout(() => setEngineStatus(null), 2000);
      }
      return;
    }

    // 2. Prevent Mane Characters/Leaders from entering the 50-card Main Deck
    if (isLeaderCard(card)) {
      return showError('Mane Characters cannot be added to the Main Deck class slots.');
    }

    const cardType = card.type || '';

    if (isSceneCard(cardType)) {
      if (selectedDeck.scenes.length >= 4) return showError('Maximum 4 Scene cards allowed.');
      setSelectedDeck({ ...selectedDeck, scenes: [...selectedDeck.scenes, card] });
      return;
    }

    if (isStoryCard(cardType)) {
      if (selectedDeck.stories.length >= 4) return showError('Maximum 4 Story cards allowed.');
      setSelectedDeck({ ...selectedDeck, stories: [...selectedDeck.stories, card] });
      return;
    }

    // 3. Main Deck Size & Copy Limits
    if (selectedDeck.cards.length >= MAX_DECK_SIZE) {
      return showError(`Main deck is full! Maximum ${MAX_DECK_SIZE} cards allowed.`);
    }

    const currentCopies = selectedDeck.cards.filter(c => c.id === card.id).length;
    if (currentCopies >= MAX_COPIES_PER_CARD) {
      return showError(`Limit reached! Max ${MAX_COPIES_PER_CARD} copies allowed.`);
    }

    setSelectedDeck({ ...selectedDeck, cards: [...selectedDeck.cards, card] });
  };

  const handleRemoveCard = (cardId: string | number, category: 'cards' | 'scenes' | 'stories') => {
    if (!selectedDeck) return;
    if (category === 'cards') {
      const indexToRemove = selectedDeck.cards.findIndex(c => c.id === cardId);
      if (indexToRemove !== -1) {
        const updatedCards = [...selectedDeck.cards];
        updatedCards.splice(indexToRemove, 1);
        setSelectedDeck({ ...selectedDeck, cards: updatedCards });
      }
    } else {
      const updatedList = selectedDeck[category].filter(c => c.id !== cardId);
      setSelectedDeck({ ...selectedDeck, [category]: updatedList });
    }
  };

  const uniqueCardTypes = useMemo(() => {
    const types = new Set<string>();
    catalogCards.forEach(c => {
      if (c.type) types.add(c.type.trim());
    });
    return ['All', 'Leader / Mane Character', ...Array.from(types)] as string[];
  }, [catalogCards]);

  const filteredCatalog = useMemo(() => {
    const result = catalogCards.filter(c => {
      const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase());
      const isLdr = isLeaderCard(c);

      // 1. Strict Leader Filter
      if (typeFilter === 'Leader / Mane Character') {
        return matchesSearch && isLdr;
      }

      // 2. Strict Standard Character Filter (Exclude Leaders)
      if (typeFilter.toLowerCase() === 'character') {
        const isStandardCharacter = c.type && c.type.trim().toLowerCase() === 'character';
        return matchesSearch && isStandardCharacter && !isLdr;
      }

      // 3. All Cards Filter
      if (typeFilter === 'All') {
        return matchesSearch;
      }

      // 4. Other Types (Event, Story, Item, etc.)
      const matchesType = c.type && c.type.trim().toLowerCase() === typeFilter.trim().toLowerCase();
      return matchesSearch && matchesType;
    });

    return [...result].sort((a, b) => {
      const aIsLdr = isLeaderCard(a);
      const bIsLdr = isLeaderCard(b);
      if (aIsLdr && !bIsLdr) return -1;
      if (!aIsLdr && bIsLdr) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [catalogCards, searchTerm, typeFilter]);

  const stackedDeckCards = useMemo(() => {
    if (!selectedDeck) return [];
    const counts: Record<string, { card: Card, count: number }> = {};
    selectedDeck.cards.forEach(card => {
      if (!counts[card.id]) counts[card.id] = { card, count: 0 };
      counts[card.id].count += 1;
    });
    return Object.values(counts).sort((a, b) => a.card.name.localeCompare(b.card.name));
  }, [selectedDeck?.cards]);

  const handleSelectLeaderPrompt = () => {
    setTypeFilter('Leader / Mane Character');
    setEngineStatus('Browse and click a Leader card to assign/change.');
    setTimeout(() => setEngineStatus(null), 3000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {engineStatus && <div style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '10px', borderRadius: '12px', textAlign: 'center', fontWeight: 800 }}>{engineStatus}</div>}
      {errorMsg && <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '10px', borderRadius: '12px', textAlign: 'center', fontWeight: 800 }}>{errorMsg}</div>}

      {viewMode === 'hub' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, #fdf4f8, #f3e8ff)', padding: '24px', borderRadius: '20px', border: '1px solid #fbcfe8' }}>
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 900, margin: '0 0 4px 0', color: '#1c1917' }}>🃏 Deck Builder Hub</h2>
              <p style={{ margin: 0, color: '#57534e', fontSize: '0.9rem' }}>Build, edit, and validate your Kayou MLP decks, leaders, and scenarios.</p>
            </div>
            <button onClick={handleCreateNewDeck} style={{ background: '#db2777', color: 'white', fontWeight: 800, padding: '12px 20px', borderRadius: '12px', border: 'none', cursor: 'pointer' }}>+ New Deck</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
            {decks.map(deck => (
              <div key={deck.id} style={{ backgroundColor: 'white', padding: '16px', borderRadius: '16px', border: '1px solid #fde0e8', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div onClick={() => { setSelectedDeck(deck); setViewMode('editor'); }} style={{ cursor: 'pointer' }}>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '1rem', fontWeight: 800 }}>{deck.name}</h4>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#78716c' }}>Cards: {deck.cards?.length || 0} / {MAX_DECK_SIZE} | Scenes: {deck.scenes?.length || 0} | Stories: {deck.stories?.length || 0}</p>
                </div>
                <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid #fdf2f8', paddingTop: '8px' }}>
                  <button onClick={() => { setSelectedDeck(deck); setViewMode('editor'); }} style={{ flex: 1, backgroundColor: '#fdf2f8', color: '#db2777', border: '1px solid #fbcfe8', padding: '6px', borderRadius: '8px', fontWeight: 800, cursor: 'pointer', fontSize: '0.75rem' }}>Edit</button>
                  <button onClick={() => handleDeleteDeck(deck.id)} style={{ backgroundColor: '#fee2e2', color: '#dc2626', border: 'none', padding: '6px 10px', borderRadius: '8px', fontWeight: 800, cursor: 'pointer', fontSize: '0.75rem' }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, #fdf4f8, #f3e8ff)', padding: '16px 20px', borderRadius: '16px', border: '1px solid #fbcfe8' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button onClick={() => setViewMode('hub')} style={{ background: '#e7e5e4', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: 800, cursor: 'pointer' }}>⬅ Back</button>
              <input type="text" value={selectedDeck?.name || ''} onChange={(e) => selectedDeck && setSelectedDeck({ ...selectedDeck, name: e.target.value })} style={{ fontSize: '1.1rem', fontWeight: 900, background: 'transparent', border: 'none', borderBottom: '2px dashed #db2777', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <span style={{ fontWeight: 800, fontSize: '0.85rem', color: selectedDeck?.cards.length === MAX_DECK_SIZE ? '#16a34a' : '#db2777' }}>
                Main Deck: {selectedDeck?.cards.length || 0} / {MAX_DECK_SIZE}
              </span>
              <button onClick={handleSaveDeck} style={{ background: '#059669', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '10px', fontWeight: 800, cursor: 'pointer' }}>Save Deck</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '20px' }}>
            {/* Catalog Grid */}
            <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '16px', border: '1px solid #fde0e8', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <input type="text" placeholder="Search cards..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ flex: 1, minWidth: '180px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #fbcfe8', outline: 'none' }} />
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #fbcfe8', fontWeight: 700, backgroundColor: '#fdf2f8', color: '#db2777' }}>
                  {uniqueCardTypes.map(t => <option key={t} value={t}>Filter: {t}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px', maxHeight: '550px', overflowY: 'auto' }}>
                {filteredCatalog.map(card => {
                  const currentCopies = selectedDeck?.cards.filter(c => c.id === card.id).length || 0;
                  const isLeader = selectedDeck?.maneCharacter?.id === card.id;
                  const isLdrCard = isLeaderCard(card);
                  const isMaxedOut = !isLdrCard && currentCopies >= MAX_COPIES_PER_CARD;

                  return (
                    <div key={card.id} onClick={() => !isMaxedOut && handleAddCard(card)} style={{ border: isLdrCard ? '2px solid #a855f7' : '1px solid #fbcfe8', borderRadius: '10px', padding: '8px', cursor: isMaxedOut ? 'not-allowed' : 'pointer', opacity: isMaxedOut ? 0.5 : 1, backgroundColor: isLdrCard ? '#faf5ff' : 'white', position: 'relative' }}>
                      {isLdrCard && (
                        <span style={{ position: 'absolute', top: '-6px', left: '6px', backgroundColor: '#a855f7', color: 'white', borderRadius: '4px', padding: '1px 4px', fontSize: '0.6rem', fontWeight: 900 }}>LEADER</span>
                      )}
                      {currentCopies > 0 && !isLdrCard && (
                        <span style={{ position: 'absolute', top: '-6px', right: '-6px', backgroundColor: '#db2777', color: 'white', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 900 }}>{currentCopies}</span>
                      )}
                      <div style={{ height: '110px', backgroundColor: '#fdf2f8', borderRadius: '6px', marginBottom: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        <img 
                          src={card.imageUrl ? (card.imageUrl.startsWith('http') ? card.imageUrl : `https://cards.equestria-clash.pages.dev/assets/${card.id}.webp`) : `https://cards.equestria-clash.pages.dev/assets/${card.id}.webp`} 
                          alt={card.name} 
                          style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '6px' }} 
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140" viewBox="0 0 100 140"><rect width="100" height="140" fill="%23fdf2f8"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23db2777" font-family="sans-serif" font-size="10" font-weight="bold">No Art</text></svg>';
                          }}
                        />
                      </div>
                      <h5 style={{ margin: 0, fontSize: '0.75rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.name}</h5>
                      <span style={{ fontSize: '0.6rem', color: '#78716c', textTransform: 'uppercase' }}>{card.type || 'Card'}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Deck Editor Sidebar */}
            <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '16px', border: '1px solid #fde0e8', display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '620px', overflowY: 'auto' }}>
              
              {/* Mane Leader Section */}
              <div>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '0.85rem', fontWeight: 800, color: '#6b21a8' }}>✨ Mane Character Leader</h4>
                {selectedDeck?.maneCharacter ? (
                  <div onClick={handleSelectLeaderPrompt} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f3e8ff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d8b4fe', cursor: 'pointer' }} title="Click to change leader">
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#6b21a8' }}>{selectedDeck.maneCharacter.name} (Click to change)</span>
                    <button onClick={(e) => { e.stopPropagation(); setSelectedDeck({ ...selectedDeck, maneCharacter: null }); }} style={{ background: '#a855f7', color: 'white', border: 'none', width: '20px', height: '20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 900 }}>✕</button>
                  </div>
                ) : (
                  <div onClick={handleSelectLeaderPrompt} style={{ padding: '12px', textAlign: 'center', fontSize: '0.75rem', color: '#6b21a8', backgroundColor: '#fdf4f8', border: '2px dashed #db2777', borderRadius: '8px', cursor: 'pointer', fontWeight: 800 }}>
                    ⚠️ Click here to select Mane Leader!
                  </div>
                )}
              </div>

              {/* Scenes Section */}
              <div>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '0.85rem', fontWeight: 800, color: '#0284c7' }}>🎬 Scenes ({selectedDeck?.scenes?.length || 0}/4)</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '90px', overflowY: 'auto' }}>
                  {selectedDeck?.scenes?.map(card => (
                    <div key={card.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#e0f2fe', padding: '4px 8px', borderRadius: '6px', fontSize: '0.75rem' }}>
                      <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{card.name}</span>
                      <button onClick={() => handleRemoveCard(card.id, 'scenes')} style={{ background: '#0284c7', color: 'white', border: 'none', width: '18px', height: '18px', borderRadius: '3px', cursor: 'pointer', fontSize: '0.65rem' }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stories Section */}
              <div>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '0.85rem', fontWeight: 800, color: '#d97706' }}>📖 Stories ({selectedDeck?.stories?.length || 0}/4)</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '90px', overflowY: 'auto' }}>
                  {selectedDeck?.stories?.map(card => (
                    <div key={card.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fef3c7', padding: '4px 8px', borderRadius: '6px', fontSize: '0.75rem' }}>
                      <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{card.name}</span>
                      <button onClick={() => handleRemoveCard(card.id, 'stories')} style={{ background: '#d97706', color: 'white', border: 'none', width: '18px', height: '18px', borderRadius: '3px', cursor: 'pointer', fontSize: '0.65rem' }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Main Deck Section */}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '0.85rem', fontWeight: 800 }}>📦 Main Deck Cards</h4>
                <div style={{ flex: 1, maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {stackedDeckCards.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px 0', color: '#a8a29e', fontSize: '0.75rem' }}>No main deck cards added yet.</div>
                  ) : (
                    stackedDeckCards.map(({ card, count }) => (
                      <div key={card.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fdf2f8', padding: '6px 10px', borderRadius: '8px', border: '1px solid #fce7f3' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                          <span style={{ backgroundColor: '#db2777', color: 'white', fontWeight: 900, fontSize: '0.65rem', padding: '2px 5px', borderRadius: '4px' }}>{count}x</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>{card.name}</span>
                        </div>
                        <button onClick={() => handleRemoveCard(card.id, 'cards')} style={{ background: '#ef4444', color: 'white', border: 'none', width: '20px', height: '20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 900, fontSize: '0.75rem' }}>−</button>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}