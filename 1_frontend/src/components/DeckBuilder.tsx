import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE_URL } from '../config';

const MAX_DECK_SIZE = 50;
const MAX_SCENES_SIZE = 15;
const MAX_COPIES_PER_CARD = 3;

interface Card {
  id: string | number;
  name: string;
  type?: string; 
  element?: string;
  imageUrl?: string;
  cardNumber?: string;
  effect?: string;
}

interface Deck {
  id: string | number;
  name: string;
  isPublic?: boolean;
  maneCharacter: Card | null;
  cards: Card[];
  scenes: Card[];
  stories: Card[];
}

export default function DeckBuilder() {
  const [viewMode, setViewMode] = useState<'hub' | 'editor'>('hub');
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [catalogCards, setCatalogCards] = useState<Card[]>([]);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [builderStep, setBuilderStep] = useState<'leader' | 'stories' | 'scenes' | 'main'>('leader');
  const [engineStatus, setEngineStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Modal State for Story Confirmation & Selection Popup
  const [pendingStories, setPendingStories] = useState<Card[]>([]);
  const [pendingLeader, setPendingLeader] = useState<Card | null>(null);
  const [showStoryModal, setShowStoryModal] = useState<boolean>(false);
  const [allStoryGroups, setAllStoryGroups] = useState<Record<string, Card[]>>({});
  const [selectedStoryKey, setSelectedStoryKey] = useState<string>('');

  const isLeaderCard = (card: Card) => {
    const id = String(card.id || card.cardNumber || '').toUpperCase();
    const isStarterFlagship = /-001$/.test(id);
    const isLeaderRarity = id.includes('-RR') || id.includes('-CR') || id.includes('-GR');
    const typeStr = (card.type || '').toLowerCase();
    const explicitLeaderType = typeStr.includes('leader') || typeStr.includes('main character');

    return isStarterFlagship || isLeaderRarity || explicitLeaderType;
  };

  const isSceneCard = (card: Card) => {
    const typeStr = (card.type || '').toLowerCase();
    const nameStr = (card.name || '').toLowerCase();
    return typeStr.includes('scene') || nameStr.includes('scene') || typeStr.includes('stage') || typeStr.includes('location');
  };

  const isStoryCard = (card: Card) => {
    const typeStr = (card.type || '').toLowerCase();
    const nameStr = (card.name || '').toLowerCase();
    return typeStr.includes('story') || nameStr.includes('story') || typeStr.includes('quest') || typeStr.includes('chapter');
  };

  // Group all story cards into distinct story sets/arcs based on name or set code
  const buildStoryGroups = (allCards: Card[]) => {
    const stories = allCards.filter(c => isStoryCard(c) || (c.type || '').toLowerCase().includes('event'));
    const groups: Record<string, Card[]> = {};
    
    if (stories.length === 0) {
      // Ultimate fallback if no tags match
      groups['Default Story Set'] = allCards.slice(0, 4);
      return groups;
    }

    stories.forEach(s => {
      // Group by the base name of the story (ignoring Stage I, II, III, IV suffixes)
      const baseName = (s.name || '').replace(/[-–—]\s*(Stage|Part|Episode)?\s*[0-9IVX]+/gi, '').trim() || 'Story Set';
      if (!groups[baseName]) groups[baseName] = [];
      groups[baseName].push(s);
    });

    // Ensure every group has up to 4 items
    Object.keys(groups).forEach(key => {
      if (groups[key].length > 4) {
        groups[key] = groups[key].slice(0, 4);
      }
    });

    return groups;
  };

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      fetch(`${API_BASE_URL}/api/decks`).then(res => res.ok ? res.json() : Promise.reject()).catch(() => null),
      fetch(`${API_BASE_URL}/api/cards`).then(res => res.ok ? res.json() : Promise.reject()).catch(() => null)
    ]).then(([decksData, cardsData]) => {
      if (Array.isArray(decksData)) {
        const normalized = decksData.map((d: any) => ({
          ...d,
          isPublic: d.isPublic ?? false,
          scenes: d.scenes || [],
          stories: d.stories || []
        }));
        setDecks(normalized);
      } else {
        const saved = localStorage.getItem('socal_mlp_decks');
        if (saved) setDecks(JSON.parse(saved));
      }

      if (Array.isArray(cardsData)) {
        setCatalogCards(cardsData);
        const groups = buildStoryGroups(cardsData);
        setAllStoryGroups(groups);
      }
    }).finally(() => {
      setIsLoading(false);
    });
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
      isPublic: false,
      maneCharacter: null,
      cards: [],
      scenes: [],
      stories: []
    };
    saveDecksToStorage([newDeck, ...decks]);
    setSelectedDeck(newDeck);
    setViewMode('editor');
    setBuilderStep('leader');
    setEngineStatus('Step 1: Select your Mane Character Leader from the catalog.');
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
    if (selectedDeck.scenes.length !== MAX_SCENES_SIZE) return showError(`Scene deck must contain exactly ${MAX_SCENES_SIZE} cards (currently ${selectedDeck.scenes.length}).`);
    if (selectedDeck.cards.length !== MAX_DECK_SIZE) return showError(`Main deck must contain exactly ${MAX_DECK_SIZE} cards (currently ${selectedDeck.cards.length}).`);

    const updatedList = decks.map(d => d.id === selectedDeck.id ? selectedDeck : d);
    saveDecksToStorage(updatedList);
    setEngineStatus(`Successfully saved "${selectedDeck.name}"!`);
    setTimeout(() => setEngineStatus(null), 3000);
  };

  const handleExportDeck = () => {
    if (!selectedDeck) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(selectedDeck, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${selectedDeck.name.toLowerCase().replace(/\s+/g, '_')}_deck.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setEngineStatus('Deck exported successfully!');
    setTimeout(() => setEngineStatus(null), 2500);
  };

  const handleImportDeck = () => {
    const jsonInput = prompt("Paste your exported deck JSON code here:");
    if (!jsonInput) return;
    try {
      const importedDeck = JSON.parse(jsonInput);
      if (!importedDeck.name || !Array.isArray(importedDeck.cards)) {
        throw new Error('Invalid deck structure.');
      }
      const newDeck: Deck = {
        ...importedDeck,
        id: 'deck-' + Date.now(),
        name: `${importedDeck.name} (Imported)`
      };
      saveDecksToStorage([newDeck, ...decks]);
      setEngineStatus(`Successfully imported "${newDeck.name}"!`);
      setTimeout(() => setEngineStatus(null), 3000);
    } catch (e) {
      showError('Failed to import deck. Please check the JSON format.');
    }
  };

  const handleAddCard = (card: Card) => {
    if (!selectedDeck) return;
    
    // Step 1: Leader Selection
    if (!selectedDeck.maneCharacter) {
      if (!isLeaderCard(card)) {
        return showError('Step 1: Please select a valid Mane Character leader card first!');
      }
      const storyKeys = Object.keys(allStoryGroups);
      const defaultKey = storyKeys[0] || '';
      setSelectedStoryKey(defaultKey);
      setPendingStories(allStoryGroups[defaultKey] || []);
      setPendingLeader(card);
      setShowStoryModal(true);
      return;
    }

    if (isLeaderCard(card)) {
      if (confirm(`Change Mane Leader to ${card.name}? (Note: This will reset your deck).`)) {
        const storyKeys = Object.keys(allStoryGroups);
        const defaultKey = storyKeys[0] || '';
        setSelectedStoryKey(defaultKey);
        setPendingStories(allStoryGroups[defaultKey] || []);
        setPendingLeader(card);
        setShowStoryModal(true);
      }
      return;
    }

    // Step 3: Scene Selection
    if (builderStep === 'scenes') {
      if (selectedDeck.scenes.length >= MAX_SCENES_SIZE) {
        setBuilderStep('main');
        return showError('Scene deck is full (15/15)! Switched to Step 4: Main Deck.');
      }
      const currentSceneCopies = selectedDeck.scenes.filter(c => c.id === card.id).length;
      if (currentSceneCopies >= MAX_COPIES_PER_CARD) return showError(`Limit reached! Max ${MAX_COPIES_PER_CARD} copies per scene card.`);
      
      const updatedScenes = [...selectedDeck.scenes, card];
      setSelectedDeck({ ...selectedDeck, scenes: updatedScenes });
      
      if (updatedScenes.length === MAX_SCENES_SIZE) {
        setBuilderStep('main');
        setEngineStatus('Step 3 Complete! Now select your 50 Main Deck cards (Step 4).');
        setTimeout(() => setEngineStatus(null), 4000);
      }
      return;
    }

    // Step 4: Main Deck Selection
    if (builderStep === 'main') {
      if (selectedDeck.cards.length >= MAX_DECK_SIZE) {
        return showError(`Main deck is full! Maximum ${MAX_DECK_SIZE} cards allowed.`);
      }
      const currentCopies = selectedDeck.cards.filter(c => c.id === card.id).length;
      if (currentCopies >= MAX_COPIES_PER_CARD) {
        return showError(`Limit reached! Max ${MAX_COPIES_PER_CARD} copies allowed.`);
      }

      setSelectedDeck({ ...selectedDeck, cards: [...selectedDeck.cards, card] });
      return;
    }
  };

  const handleStoryKeyChange = (key: string) => {
    setSelectedStoryKey(key);
    setPendingStories(allStoryGroups[key] || []);
  };

  const confirmStoryBundle = () => {
    if (!selectedDeck || !pendingLeader) return;
    setSelectedDeck({ 
      ...selectedDeck, 
      maneCharacter: pendingLeader, 
      cards: [], 
      scenes: [], 
      stories: pendingStories.length > 0 ? pendingStories : catalogCards.slice(0, 4)
    });
    setBuilderStep('scenes');
    setShowStoryModal(false);
    setPendingLeader(null);
    setPendingStories([]);
    setEngineStatus(`Step 2 Complete! Now select your 15 Scene cards (Step 3).`);
    setTimeout(() => setEngineStatus(null), 4000);
  };

  const cancelStoryBundle = () => {
    setShowStoryModal(false);
    setPendingLeader(null);
    setPendingStories([]);
  };

  const handleRemoveLeader = () => {
    if (!selectedDeck) return;
    if (confirm('Removing the Mane Character leader will reset your entire deck. Continue?')) {
      setSelectedDeck({
        ...selectedDeck,
        maneCharacter: null,
        cards: [],
        scenes: [],
        stories: []
      });
      setBuilderStep('leader');
      setEngineStatus('Leader removed. Step 1: Select a new Mane Character Leader.');
      setTimeout(() => setEngineStatus(null), 3000);
    }
  };

  const handleRemoveCard = (cardId: string | number, category: 'cards' | 'scenes') => {
    if (!selectedDeck) return;
    if (category === 'cards') {
      const indexToRemove = selectedDeck.cards.findIndex(c => c.id === cardId);
      if (indexToRemove !== -1) {
        const updatedCards = [...selectedDeck.cards];
        updatedCards.splice(indexToRemove, 1);
        setSelectedDeck({ ...selectedDeck, cards: updatedCards });
      }
    } else {
      const updatedList = selectedDeck.scenes.filter(c => c.id !== cardId);
      setSelectedDeck({ ...selectedDeck, scenes: updatedList });
      if (updatedList.length < MAX_SCENES_SIZE) {
        setBuilderStep('scenes');
      }
    }
  };

  // Catalog filtering strictly driven by the active step
  const filteredCatalog = useMemo(() => {
    const result = catalogCards.filter(c => {
      const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase());
      const isLdr = isLeaderCard(c);
      const isSty = isStoryCard(c);
      const isScn = isSceneCard(c);

      if (isSty) return false;

      // Step 1: Leader selection
      if (!selectedDeck?.maneCharacter || builderStep === 'leader') {
        return matchesSearch && isLdr;
      }

      if (isLdr) return false;

      // Element / Color matching rule
      const leaderElement = (selectedDeck.maneCharacter.element || '').toLowerCase();
      const cardElement = (c.element || '').toLowerCase();
      const matchesElement = !leaderElement || !cardElement || cardElement === 'neutral' || cardElement === leaderElement;

      // Step 3: Scenes filtering (with fallback to allow selection if DB type flags differ)
      if (builderStep === 'scenes') {
        const anyScenesExist = catalogCards.some(card => isSceneCard(card));
        if (anyScenesExist) {
          return matchesSearch && isScn && matchesElement;
        }
        return matchesSearch && matchesElement; 
      }

      // Step 4: Main deck cards (exclude scenes)
      if (builderStep === 'main') {
        return matchesSearch && !isScn && matchesElement;
      }

      return matchesSearch && matchesElement;
    });

    return [...result].sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogCards, searchTerm, builderStep, selectedDeck?.maneCharacter]);

  const stackedDeckCards = useMemo(() => {
    if (!selectedDeck) return [];
    const counts: Record<string, { card: Card, count: number }> = {};
    selectedDeck.cards.forEach(card => {
      if (!counts[card.id]) counts[card.id] = { card, count: 0 };
      counts[card.id].count += 1;
    });
    return Object.values(counts).sort((a, b) => a.card.name.localeCompare(b.card.name));
  }, [selectedDeck?.cards]);

  const stackedSceneCards = useMemo(() => {
    if (!selectedDeck) return [];
    const counts: Record<string, { card: Card, count: number }> = {};
    selectedDeck.scenes.forEach(card => {
      if (!counts[card.id]) counts[card.id] = { card, count: 0 };
      counts[card.id].count += 1;
    });
    return Object.values(counts).sort((a, b) => a.card.name.localeCompare(b.card.name));
  }, [selectedDeck?.scenes]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', gap: '16px' }}>
        <div style={{ width: '48px', height: '48px', border: '5px solid #fbcfe8', borderTop: '5px solid #db2777', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <div style={{ textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 4px 0', color: '#1c1917', fontWeight: 900 }}>Waking up server & loading card database...</h3>
          <p style={{ margin: 0, color: '#78716c', fontSize: '0.85rem' }}>Render free-tier instances take a few seconds to spin up from sleep. Thank you for your patience!</p>
        </div>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
      {engineStatus && <div style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '10px', borderRadius: '12px', textAlign: 'center', fontWeight: 800 }}>{engineStatus}</div>}
      {errorMsg && <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '10px', borderRadius: '12px', textAlign: 'center', fontWeight: 800 }}>{errorMsg}</div>}

      {/* Step 2: Story Selection Modal Popup (All Story Sets) */}
      {showStoryModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0, 0, 0, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '20px', maxWidth: '750px', width: '100%', display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', border: '2px solid #fbcfe8' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '1.25rem', fontWeight: 900, color: '#1c1917' }}>📖 Step 2: Select Story Arc</h3>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#78716c' }}>
                  Choose a story set to bundle with <strong style={{ color: '#6b21a8' }}>{pendingLeader?.name}</strong>:
                </p>
              </div>
              <select 
                value={selectedStoryKey} 
                onChange={(e) => handleStoryKeyChange(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #fbcfe8', fontWeight: 800, backgroundColor: '#fdf2f8', color: '#db2777', maxWidth: '280px' }}
              >
                {Object.keys(allStoryGroups).map(storyName => (
                  <option key={storyName} value={storyName}>{storyName} ({allStoryGroups[storyName].length} cards)</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', maxHeight: '350px', overflowY: 'auto', padding: '4px' }}>
              {pendingStories.map(story => (
                <div key={story.id} style={{ border: '1px solid #fbcfe8', borderRadius: '10px', padding: '8px', backgroundColor: '#fef3c7', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ height: '90px', backgroundColor: 'white', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <img 
                      src={story.imageUrl ? (story.imageUrl.startsWith('http') ? story.imageUrl : `https://cards.equestria-clash.pages.dev/assets/${story.id}.webp`) : `https://cards.equestria-clash.pages.dev/assets/${story.id}.webp`} 
                      alt={story.name} 
                      style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '6px' }} 
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140" viewBox="0 0 100 140"><rect width="100" height="140" fill="%23fdf2f8"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23db2777" font-family="sans-serif" font-size="10" font-weight="bold">No Art</text></svg>';
                      }}
                    />
                  </div>
                  <h5 style={{ margin: 0, fontSize: '0.7rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{story.name}</h5>
                  <span style={{ fontSize: '0.55rem', color: '#92400e', fontWeight: 700, lineHeight: 1.2 }}>{story.effect || 'Standard Story Card'}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #fdf2f8', paddingTop: '12px' }}>
              <button onClick={cancelStoryBundle} style={{ backgroundColor: '#e7e5e4', color: '#44403c', border: 'none', padding: '10px 18px', borderRadius: '10px', fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
              <button onClick={confirmStoryBundle} style={{ backgroundColor: '#db2777', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '10px', fontWeight: 800, cursor: 'pointer' }}>Confirm Story & Proceed to Scenes</button>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'hub' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, #fdf4f8, #f3e8ff)', padding: '24px', borderRadius: '20px', border: '1px solid #fbcfe8', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 900, margin: '0 0 4px 0', color: '#1c1917' }}>🃏 Deck Builder Hub</h2>
              <p style={{ margin: 0, color: '#57534e', fontSize: '0.9rem' }}>Build, edit, and validate your Kayou MLP decks following the official 4-step workflow.</p>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={handleImportDeck} style={{ background: '#fbcfe8', color: '#831843', fontWeight: 800, padding: '12px 16px', borderRadius: '12px', border: 'none', cursor: 'pointer' }}>📥 Import Deck</button>
              <button onClick={handleCreateNewDeck} style={{ background: '#db2777', color: 'white', fontWeight: 800, padding: '12px 20px', borderRadius: '12px', border: 'none', cursor: 'pointer' }}>+ New Deck</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
            {decks.map(deck => (
              <div key={deck.id} style={{ backgroundColor: 'white', padding: '16px', borderRadius: '16px', border: '1px solid #fde0e8', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div onClick={() => { setSelectedDeck(deck); setViewMode('editor'); setBuilderStep(deck.scenes?.length < 15 ? 'scenes' : 'main'); }} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                    <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>{deck.name}</h4>
                    <span style={{ fontSize: '0.65rem', fontWeight: 800, padding: '2px 6px', borderRadius: '6px', backgroundColor: deck.isPublic ? '#dcfce7' : '#fef3c7', color: deck.isPublic ? '#166534' : '#92400e' }}>
                      {deck.isPublic ? 'Public 🌐' : 'Private 🔒'}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#78716c' }}>Cards: {deck.cards?.length || 0} / {MAX_DECK_SIZE} | Scenes: {deck.scenes?.length || 0} / {MAX_SCENES_SIZE} | Stories: {deck.stories?.length || 0}</p>
                </div>
                <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid #fdf2f8', paddingTop: '8px' }}>
                  <button onClick={() => { setSelectedDeck(deck); setViewMode('editor'); setBuilderStep(deck.scenes?.length < 15 ? 'scenes' : 'main'); }} style={{ flex: 1, backgroundColor: '#fdf2f8', color: '#db2777', border: '1px solid #fbcfe8', padding: '6px', borderRadius: '8px', fontWeight: 800, cursor: 'pointer', fontSize: '0.75rem' }}>Edit</button>
                  <button onClick={() => handleDeleteDeck(deck.id)} style={{ backgroundColor: '#fee2e2', color: '#dc2626', border: 'none', padding: '6px 10px', borderRadius: '8px', fontWeight: 800, cursor: 'pointer', fontSize: '0.75rem' }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, #fdf4f8, #f3e8ff)', padding: '16px 20px', borderRadius: '16px', border: '1px solid #fbcfe8', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setViewMode('hub')} style={{ background: '#e7e5e4', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: 800, cursor: 'pointer' }}>⬅ Back</button>
              <input type="text" value={selectedDeck?.name || ''} onChange={(e) => selectedDeck && setSelectedDeck({ ...selectedDeck, name: e.target.value })} style={{ fontSize: '1.1rem', fontWeight: 900, background: 'transparent', border: 'none', borderBottom: '2px dashed #db2777', outline: 'none' }} />
              
              <button 
                onClick={() => selectedDeck && setSelectedDeck({ ...selectedDeck, isPublic: !selectedDeck.isPublic })} 
                style={{ 
                  backgroundColor: selectedDeck?.isPublic ? '#dcfce7' : '#fef3c7', 
                  color: selectedDeck?.isPublic ? '#166534' : '#92400e', 
                  border: `1px solid ${selectedDeck?.isPublic ? '#bbf7d0' : '#fde68a'}`, 
                  padding: '6px 12px', 
                  borderRadius: '8px', 
                  fontWeight: 800, 
                  cursor: 'pointer', 
                  fontSize: '0.75rem' 
                }}
              >
                {selectedDeck?.isPublic ? '🌐 Public' : '🔒 Private'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button onClick={handleExportDeck} style={{ background: '#fbcfe8', color: '#831843', border: 'none', padding: '10px 14px', borderRadius: '10px', fontWeight: 800, cursor: 'pointer', fontSize: '0.8rem' }}>Export JSON</button>
              <span style={{ fontWeight: 800, fontSize: '0.85rem', color: selectedDeck?.cards.length === MAX_DECK_SIZE ? '#16a34a' : '#db2777' }}>
                Main: {selectedDeck?.cards.length || 0} / {MAX_DECK_SIZE}
              </span>
              <button onClick={handleSaveDeck} style={{ background: '#059669', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '10px', fontWeight: 800, cursor: 'pointer' }}>Save Deck</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '20px' }}>
            {/* Catalog Grid */}
            <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '16px', border: '1px solid #fde0e8', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <input 
                  type="text" 
                  placeholder={builderStep === 'scenes' ? "Search scene cards (Step 3)..." : "Search main deck cards (Step 4)..."} 
                  value={searchTerm} 
                  onChange={(e) => setSearchTerm(e.target.value)} 
                  style={{ flex: 1, minWidth: '180px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #fbcfe8', outline: 'none' }} 
                />

                {/* Step Switcher Tabs */}
                {selectedDeck?.maneCharacter && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button 
                      onClick={() => setBuilderStep('scenes')} 
                      style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '0.75rem', cursor: 'pointer', backgroundColor: builderStep === 'scenes' ? '#0284c7' : '#e0f2fe', color: builderStep === 'scenes' ? 'white' : '#0369a1' }}
                    >
                      Step 3: Scenes ({selectedDeck.scenes.length}/15)
                    </button>
                    <button 
                      onClick={() => setBuilderStep('main')} 
                      style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '0.75rem', cursor: 'pointer', backgroundColor: builderStep === 'main' ? '#db2777' : '#fdf2f8', color: builderStep === 'main' ? 'white' : '#be185d' }}
                    >
                      Step 4: Main Deck ({selectedDeck.cards.length}/50)
                    </button>
                  </div>
                )}
              </div>

              {!selectedDeck?.maneCharacter && (
                <div style={{ backgroundColor: '#fdf4f8', color: '#6b21a8', padding: '8px 12px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 800, border: '1px solid #fbcfe8', textAlign: 'center' }}>
                  ✨ Step 1: Select your Mane Character Leader below.
                </div>
              )}

              {builderStep === 'scenes' && (
                <div style={{ backgroundColor: '#e0f2fe', color: '#0369a1', padding: '8px 12px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 800, border: '1px solid #bae6fd', textAlign: 'center' }}>
                  🎬 Step 3 Active: Select exactly 15 Scene cards for your Scene deck. ({selectedDeck?.scenes.length || 0}/15)
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px', maxHeight: '550px', overflowY: 'auto' }}>
                {filteredCatalog.map(card => {
                  const currentCopies = (builderStep === 'scenes' 
                    ? selectedDeck?.scenes.filter(c => c.id === card.id).length 
                    : selectedDeck?.cards.filter(c => c.id === card.id).length) || 0;
                  const isMaxedOut = currentCopies >= MAX_COPIES_PER_CARD;

                  return (
                    <div key={card.id} onClick={() => !isMaxedOut && handleAddCard(card)} style={{ border: '1px solid #fbcfe8', borderRadius: '10px', padding: '8px', cursor: isMaxedOut ? 'not-allowed' : 'pointer', opacity: isMaxedOut ? 0.5 : 1, backgroundColor: 'white', position: 'relative' }}>
                      {currentCopies > 0 && (
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

            {/* Deck Editor Sidebar (Ordered strictly by Steps 1 through 4) */}
            <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '16px', border: '1px solid #fde0e8', display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '660px', overflowY: 'auto' }}>
              
              {/* Step 1: Mane Leader Section */}
              <div>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '0.85rem', fontWeight: 800, color: '#6b21a8' }}>✨ Step 1: Mane Leader</h4>
                {selectedDeck?.maneCharacter ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f3e8ff', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d8b4fe' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#6b21a8' }}>{selectedDeck.maneCharacter.name}</span>
                    <button onClick={handleRemoveLeader} style={{ background: '#a855f7', color: 'white', border: 'none', width: '20px', height: '20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 900 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ padding: '12px', textAlign: 'center', fontSize: '0.75rem', color: '#6b21a8', backgroundColor: '#fdf4f8', border: '2px dashed #db2777', borderRadius: '8px', fontWeight: 800 }}>
                    ⚠️ Select Leader from catalog
                  </div>
                )}
              </div>

              {/* Step 2: Stories Section */}
              <div>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '0.85rem', fontWeight: 800, color: '#d97706' }}>📖 Step 2: Stories ({selectedDeck?.stories?.length || 0}/4)</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '90px', overflowY: 'auto' }}>
                  {(!selectedDeck?.stories || selectedDeck.stories.length === 0) ? (
                    <div style={{ color: '#a8a29e', fontSize: '0.7rem', textAlign: 'center', padding: '6px' }}>Pending leader selection.</div>
                  ) : (
                    selectedDeck.stories.map(card => (
                      <div key={card.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fef3c7', padding: '4px 8px', borderRadius: '6px', fontSize: '0.75rem' }}>
                        <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' }}>{card.name}</span>
                        <span style={{ fontSize: '0.6rem', color: '#b45309', fontWeight: 800 }}>LOCKED</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Step 3: Scenes Section (Max 15) */}
              <div onClick={() => setBuilderStep('scenes')} style={{ cursor: 'pointer', backgroundColor: builderStep === 'scenes' ? '#f0f9ff' : 'transparent', padding: '6px', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '0.85rem', fontWeight: 800, color: '#0284c7' }}>🎬 Step 3: Scenes ({selectedDeck?.scenes?.length || 0}/{MAX_SCENES_SIZE}) {builderStep === 'scenes' && '⭐'}</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '110px', overflowY: 'auto' }}>
                  {stackedSceneCards.length === 0 ? (
                    <div style={{ color: '#a8a29e', fontSize: '0.7rem', textAlign: 'center', padding: '6px' }}>Click here to add scenes.</div>
                  ) : (
                    stackedSceneCards.map(({ card, count }) => (
                      <div key={card.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#e0f2fe', padding: '4px 8px', borderRadius: '6px', fontSize: '0.75rem' }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', overflow: 'hidden' }}>
                          <span style={{ backgroundColor: '#0284c7', color: 'white', fontWeight: 900, fontSize: '0.6rem', padding: '1px 4px', borderRadius: '3px' }}>{count}x</span>
                          <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>{card.name}</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); handleRemoveCard(card.id, 'scenes'); }} style={{ background: '#0284c7', color: 'white', border: 'none', width: '18px', height: '18px', borderRadius: '3px', cursor: 'pointer', fontSize: '0.65rem' }}>✕</button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Step 4: Main Deck Cards */}
              <div onClick={() => setBuilderStep('main')} style={{ display: 'flex', flexDirection: 'column', flex: 1, cursor: 'pointer', backgroundColor: builderStep === 'main' ? '#fdf2f8' : 'transparent', padding: '6px', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '0.85rem', fontWeight: 800 }}>📦 Step 4: Main Deck ({selectedDeck?.cards?.length || 0}/{MAX_DECK_SIZE}) {builderStep === 'main' && '⭐'}</h4>
                <div style={{ flex: '1', maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {stackedDeckCards.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '15px 0', color: '#a8a29e', fontSize: '0.75rem' }}>Click here to add main deck cards.</div>
                  ) : (
                    stackedDeckCards.map(({ card, count }) => (
                      <div key={card.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fdf2f8', padding: '6px 10px', borderRadius: '8px', border: '1px solid #fce7f3' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                          <span style={{ backgroundColor: '#db2777', color: 'white', fontWeight: 900, fontSize: '0.65rem', padding: '2px 5px', borderRadius: '4px' }}>{count}x</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>{card.name}</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); handleRemoveCard(card.id, 'cards'); }} style={{ background: '#ef4444', color: 'white', border: 'none', width: '20px', height: '20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 900, fontSize: '0.75rem' }}>−</button>
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