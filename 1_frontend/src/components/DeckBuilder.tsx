import React, { useState, useEffect } from 'react';
import './DeckBuilder.css';

interface Card {
  id: string;
  name: string;
  set_code: string;
  card_type: string;
  cost: number;
  power: number;
  defense: number;
  traits: string;
  effect_text: string;
  element: string | null;
  rarity: string;
  image_url: string;
}

type BuildPhase = 'MANE' | 'STORY' | 'SCENE' | 'MAIN';

export default function DeckBuilder() {
  const [cards, setCards] = useState<Card[]>([]);
  
  // Strict Deck Zones
  const [maneCharacter, setManeCharacter] = useState<Card | null>(null);
  const [storyDeck, setStoryDeck] = useState<Card[]>([]);
  const [sceneDeck, setSceneDeck] = useState<Card[]>([]);
  const [mainDeck, setMainDeck] = useState<Card[]>([]);
  
  const [buildPhase, setBuildPhase] = useState<BuildPhase>('MANE');
  const deckElement = maneCharacter?.element || null;
  
  const [deckName, setDeckName] = useState('My Sparkle Deck');
  const [isPublic, setIsPublic] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRarity, setSelectedRarity] = useState<string | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Hover Inspector State
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    fetch('https://mlp-tcg-engine.onrender.com/api/cards')
      .then(res => res.json())
      .then(data => {
        setCards(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load cards:', err);
        setLoading(false);
      });
  }, []);

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const addCardToDeck = (card: Card) => {
    const baseId = card.id.replace('-S', '');

    if (buildPhase === 'MANE') {
      setManeCharacter(card);
      setBuildPhase('STORY'); // Auto-advance
    } 
    else if (buildPhase === 'SCENE') {
      if (sceneDeck.length >= 15) return alert('Scene Deck is full (15/15).');
      const copies = sceneDeck.filter(c => c.id.replace('-S', '') === baseId).length;
      const isBasic = card.traits?.toLowerCase().includes('everyday');
      if (!isBasic && copies >= 3) return alert('You can only have 3 copies of a non-basic Scene.');
      
      const newSceneDeck = [...sceneDeck, card];
      setSceneDeck(newSceneDeck);
      if (newSceneDeck.length === 15) setBuildPhase('MAIN'); // Auto-advance
    } 
    else if (buildPhase === 'MAIN') {
      if (mainDeck.length >= 50) return alert('Main Deck is full (50/50).');
      const copies = mainDeck.filter(c => c.id.replace('-S', '') === baseId).length;
      if (copies >= 3) return alert('You can only have 3 copies of any card.');
      
      setMainDeck([...mainDeck, card]);
    }
  };

  const addStoryGroup = (group: Card[]) => {
    if (storyDeck.length + group.length > 4) return alert('Story Deck can only hold 4 cards.');
    setStoryDeck([...storyDeck, ...group]);
    setBuildPhase('SCENE'); // Auto-advance
  };

  const removeCard = (zone: string, index: number) => {
    if (zone === 'mane') {
      const confirmReset = window.confirm('Removing your Mane Character will reset your deck element and clear all other cards. Continue?');
      if (confirmReset) {
        setManeCharacter(null);
        setStoryDeck([]);
        setSceneDeck([]);
        setMainDeck([]);
        setBuildPhase('MANE');
      }
    }
    if (zone === 'story') setStoryDeck(storyDeck.filter((_, i) => i !== index));
    if (zone === 'scene') setSceneDeck(sceneDeck.filter((_, i) => i !== index));
    if (zone === 'main') setMainDeck(mainDeck.filter((_, i) => i !== index));
  };

  // --- STRICT FILTERING LOGIC ---
  const baseFilteredCards = cards.filter(card => {
    if (card.id.includes('-S')) return false; // Hide alternate arts from base builder
    const matchesSearch = card.name.toLowerCase().includes(searchQuery.toLowerCase()) || card.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRarity = selectedRarity === 'ALL' || card.rarity === selectedRarity;
    return matchesSearch && matchesRarity;
  });

  let displayCards: Card[] = [];
  if (buildPhase === 'MANE') {
    displayCards = baseFilteredCards.filter(c => c.card_type === 'Mane Character');
  } else if (buildPhase === 'STORY') {
    displayCards = baseFilteredCards.filter(c => c.card_type === 'Story' && c.element === deckElement);
  } else if (buildPhase === 'SCENE') {
    displayCards = baseFilteredCards.filter(c => c.card_type === 'Scene' && c.element === deckElement);
  } else if (buildPhase === 'MAIN') {
    displayCards = baseFilteredCards.filter(c => 
      ['Character', 'Friend Character', 'Event', 'Item'].includes(c.card_type) && 
      (c.element === deckElement || !c.element) // Must match element OR be colorless
    );
  }

  // --- STORY STACKING LOGIC ---
  const storyGroups = displayCards.reduce((acc, card) => {
    // Group stories by their base name (stripping numerals like I, II, III, IV)
    const baseName = card.name.replace(/\s+(I|II|III|IV|V)$/i, '').trim();
    if (!acc[baseName]) acc[baseName] = [];
    acc[baseName].push(card);
    acc[baseName].sort((a, b) => a.id.localeCompare(b.id)); // Keep sequential order
    return acc;
  }, {} as Record<string, Card[]>);

  const totalCards = (maneCharacter ? 1 : 0) + storyDeck.length + sceneDeck.length + mainDeck.length;

  return (
    <div className="deck-builder-container" onMouseMove={handleMouseMove}>
      
      {/* Floating Inspector Popup */}
      {hoveredCard && (
        <div className="card-popup" style={{ left: mousePos.x + 20, top: mousePos.y + 20 }}>
          <img src={hoveredCard.image_url} alt={hoveredCard.name} />
          <div className="card-popup-details">
            <div className="popup-title">{hoveredCard.name}</div>
            <div className="popup-type">{hoveredCard.card_type} • {hoveredCard.id}</div>
            
            <div className="popup-stats-grid">
              {['Character', 'Friend Character', 'Event', 'Item'].includes(hoveredCard.card_type) && (
                <div className="stat-box cost-box">Cost: {hoveredCard.cost}</div>
              )}
              {['Character', 'Friend Character'].includes(hoveredCard.card_type) && (
                <div className="stat-box power-box">Power: {hoveredCard.power}</div>
              )}
              {hoveredCard.element && (
                <div className={`stat-box element-box ${hoveredCard.element.toLowerCase()}`}>{hoveredCard.element}</div>
              )}
            </div>

            <div className="popup-effect">{hoveredCard.effect_text || 'No effect.'}</div>
            <div className="popup-traits">Traits: {hoveredCard.traits || 'None'}</div>
          </div>
        </div>
      )}

      {/* Left Column: Phase-Based Card Library */}
      <div className="card-library-section">
        
        {/* Phase Tracker */}
        <div className="phase-tracker">
          <button className={`phase-btn ${buildPhase === 'MANE' ? 'active' : ''}`} onClick={() => setBuildPhase('MANE')}>1. Mane</button>
          <button className={`phase-btn ${buildPhase === 'STORY' ? 'active' : ''}`} onClick={() => maneCharacter && setBuildPhase('STORY')} disabled={!maneCharacter}>2. Story</button>
          <button className={`phase-btn ${buildPhase === 'SCENE' ? 'active' : ''}`} onClick={() => maneCharacter && setBuildPhase('SCENE')} disabled={!maneCharacter}>3. Scenes</button>
          <button className={`phase-btn ${buildPhase === 'MAIN' ? 'active' : ''}`} onClick={() => maneCharacter && setBuildPhase('MAIN')} disabled={!maneCharacter}>4. Main Deck</button>
        </div>

        <div className="filters-bar">
          <input 
            type="text" 
            placeholder="Search ponies, items, IDs..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="search-input input-bubble"
          />
          <select value={selectedRarity} onChange={e => setSelectedRarity(e.target.value)} className="rarity-select input-bubble">
            <option value="ALL">All Rarities</option>
            <option value="C">Common</option>
            <option value="U">Uncommon</option>
            <option value="SR">Silver Rare</option>
            <option value="SPR">Sapphire Rare</option>
            <option value="CR">Colorful Rare</option>
            <option value="GR">Gold Rare</option>
            <option value="RR">Ruby Rare</option>
          </select>
        </div>

        {loading ? (
          <div className="loading-sparkles">Gathering cards... ✨</div>
        ) : (
          <div className="card-grid">
            {buildPhase === 'STORY' ? (
              // Render Stories as Splaying Stacks
              Object.entries(storyGroups).map(([groupName, group]) => (
                <div 
                  key={groupName} 
                  className="story-stack" 
                  onClick={() => addStoryGroup(group)}
                  onMouseEnter={() => setHoveredCard(group[0])} // Hover shows the first stage
                  onMouseLeave={() => setHoveredCard(null)}
                >
                  {group.map((card, index) => (
                    <img 
                      key={card.id}
                      className="story-card-layer"
                      src={card.image_url} 
                      alt={card.name} 
                      style={{ zIndex: 4 - index }}
                      onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder-card.png'; }}
                    />
                  ))}
                  <div className="story-stack-label">{groupName} ({group.length})</div>
                </div>
              ))
            ) : (
              // Render Normal Grid for Mane, Scene, and Main
              displayCards.map(card => (
                <div 
                  key={card.id} 
                  className="card-item" 
                  onClick={() => addCardToDeck(card)}
                  onMouseEnter={() => setHoveredCard(card)}
                  onMouseLeave={() => setHoveredCard(null)}
                >
                  <img 
                    src={card.image_url} 
                    alt={card.name} 
                    loading="lazy" 
                    onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder-card.png'; }} 
                  />
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Right Column: Active Deck */}
      <div className="deck-panel-section">
        
        {/* Dynamic Element Banner */}
        <div className={`element-banner ${deckElement ? deckElement.toLowerCase() : 'unaligned'}`}>
          {deckElement ? `Current Element: ${deckElement}` : 'Awaiting Mane Character...'}
        </div>

        <div className="deck-meta-inputs">
          <input 
            type="text" 
            value={deckName} 
            onChange={e => setDeckName(e.target.value)} 
            placeholder="Name your fabulous deck!"
            className="deck-name-input input-bubble"
          />
          <label className="public-checkbox">
            <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
            Make Public
          </label>
        </div>

        <div className="deck-header-stats">
          <span>Cards: <strong>{totalCards}</strong> / 70</span>
        </div>

        <div className="deck-zones-container">
          
          <div className="deck-zone">
            <h3>Mane Character (1)</h3>
            {maneCharacter ? (
               <div className="deck-row mane-row" onClick={() => removeCard('mane', 0)}>
                 <span>{maneCharacter.name}</span>
                 <span className="remove-tag">✕</span>
               </div>
            ) : <div className="empty-zone">Select a Mane Character</div>}
          </div>

          <div className="deck-zone">
            <h3>Story Deck ({storyDeck.length}/4)</h3>
            {storyDeck.map((c, i) => (
              <div key={i} className="deck-row" onClick={() => removeCard('story', i)}>
                <span>{c.name}</span><span className="remove-tag">✕</span>
              </div>
            ))}
          </div>

          <div className="deck-zone">
            <h3>Scene Deck ({sceneDeck.length}/15)</h3>
            {sceneDeck.map((c, i) => (
              <div key={i} className="deck-row" onClick={() => removeCard('scene', i)}>
                <span>{c.name}</span><span className="remove-tag">✕</span>
              </div>
            ))}
          </div>

          <div className="deck-zone main-deck-zone">
            <h3>Main Deck ({mainDeck.length}/50)</h3>
            {mainDeck.map((c, i) => (
              <div key={i} className="deck-row" onClick={() => removeCard('main', i)}>
                <span>{c.name}</span><span className="remove-tag">✕</span>
              </div>
            ))}
          </div>

        </div>

        <button onClick={() => {}} disabled={saving || mainDeck.length < 50} className="save-deck-btn bubble-btn">
          {saving ? 'Saving...' : '✨ Save Deck ✨'}
        </button>
      </div>
    </div>
  );
}