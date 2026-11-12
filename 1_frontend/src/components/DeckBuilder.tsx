import React, { useState, useEffect, useRef } from 'react';
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
  
  const [maneCharacter, setManeCharacter] = useState<Card | null>(null);
  const [storyDeck, setStoryDeck] = useState<Card[]>([]);
  const [sceneDeck, setSceneDeck] = useState<Card[]>([]);
  const [mainDeck, setMainDeck] = useState<Card[]>([]);
  
  const [buildPhase, setBuildPhase] = useState<BuildPhase>('MANE');
  const deckElement = maneCharacter?.element || null;
  
  const [deckName, setDeckName] = useState('My Sparkle Deck');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRarity, setSelectedRarity] = useState<string | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);

  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const hoverTimer = useRef<NodeJS.Timeout | null>(null);

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

  const handleMouseEnter = (card: Card) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setHoveredCard(card);
    }, 600); 
  };

  const handleMouseLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoveredCard(null);
  };

  const addCardToDeck = (card: Card) => {
    const baseId = card.id.replace('-S', '');

    if (buildPhase === 'MANE') {
      setManeCharacter(card);
      setBuildPhase('STORY'); 
    } 
    else if (buildPhase === 'SCENE') {
      if (sceneDeck.length >= 15) return alert('Scene Deck is full (15/15).');
      const copies = sceneDeck.filter(c => c.id.replace('-S', '') === baseId).length;
      const isBasic = card.traits?.toLowerCase().includes('everyday');
      if (!isBasic && copies >= 3) return alert('You can only have 3 copies of a non-basic Scene.');
      
      const newSceneDeck = [...sceneDeck, card];
      setSceneDeck(newSceneDeck);
      if (newSceneDeck.length === 15) setBuildPhase('MAIN'); 
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
    setBuildPhase('SCENE'); 
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

  const baseFilteredCards = cards.filter(card => {
    if (card.id.includes('-S')) return false; 
    const matchesSearch = card.name.toLowerCase().includes(searchQuery.toLowerCase()) || card.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRarity = selectedRarity === 'ALL' || card.rarity === selectedRarity;
    return matchesSearch && matchesRarity;
  });

  let displayCards: Card[] = [];
  if (buildPhase === 'MANE') {
    displayCards = baseFilteredCards.filter(c => 
      c.card_type === 'Mane Character' && 
      !c.name.includes(' - ') && 
      !c.name.includes(' – ') &&
      !c.name.includes('Stage') &&
      !c.id.includes('ST')
    );
  } else if (buildPhase === 'STORY') {
    displayCards = baseFilteredCards.filter(c => 
      c.card_type === 'Story' || 
      /-(?:C2[5-9]|C[3-4]\d)/.test(c.id) ||
      c.name.includes(' - ') || 
      c.name.includes(' – ')
    );
  } else if (buildPhase === 'SCENE') {
    displayCards = baseFilteredCards.filter(c => 
      c.card_type === 'Scene' && 
      (c.element === deckElement || !c.element)
    );
  } else if (buildPhase === 'MAIN') {
    displayCards = baseFilteredCards.filter(c => 
      ['Character', 'Friend Character', 'Event', 'Item'].includes(c.card_type) && 
      (c.element === deckElement || !c.element) 
    );
  }

  // FOOLPROOF SET-BLOCK GROUPING: Groups story cards strictly by set code and 4-card ID numeric blocks
  const storyGroups = displayCards.reduce((acc, card) => {
    const match = card.id.match(/^([A-Z0-9]+)-C(\d+)$/);
    let groupKey = '';
    
    if (match) {
      const setPrefix = match[1];
      const cardNum = parseInt(match[2], 10);
      const blockIndex = Math.floor((cardNum - 25) / 4);
      groupKey = `${setPrefix}-StoryArc-${blockIndex >= 0 ? blockIndex : cardNum}`;
    } else {
      const cleanName = card.name
        .replace(/[-–]\s*(Part\s*\d+|Chapter\s*\d+|\d+|I|II|III|IV|V|Story\s*\d+)$/i, '')
        .split(/[-–]/)[0]
        .trim();
      groupKey = `${card.set_code}-${cleanName}`;
    }

    if (!acc[groupKey]) acc[groupKey] = [];
    acc[groupKey].push(card);
    acc[groupKey].sort((a, b) => a.id.localeCompare(b.id)); 
    return acc;
  }, {} as Record<string, Card[]>);

  const totalCards = (maneCharacter ? 1 : 0) + storyDeck.length + sceneDeck.length + mainDeck.length;

  return (
    <div className="deck-builder-container">
      
      {/* MTG STYLE FIXED INSPECTOR POPUP */}
      {hoveredCard && (
        <div className="inspector-overlay">
          <div className="inspector-modal">
            <div className="inspector-image-container">
              <img src={hoveredCard.image_url} alt={hoveredCard.name} />
            </div>
            <div className="inspector-data-panel">
              <div className="inspector-header">
                <h2>{hoveredCard.name}</h2>
                {['Character', 'Friend Character', 'Event', 'Item'].includes(hoveredCard.card_type) && (
                   <div className="cost-badge">{hoveredCard.cost}</div>
                )}
              </div>
              
              <div className="inspector-meta-row">
                <div className="meta-block">
                  <span className="meta-label">TYPE</span>
                  <span className="meta-value">{hoveredCard.card_type}</span>
                </div>
                <div className="meta-block right-align">
                  <span className="meta-label">RARITY</span>
                  <span className="meta-value">{hoveredCard.rarity}</span>
                </div>
              </div>

              <div className="inspector-rules-text">
                <div className="meta-label">RULES TEXT</div>
                <p>{hoveredCard.effect_text || 'No abilities.'}</p>
              </div>

              {['Character', 'Friend Character'].includes(hoveredCard.card_type) && (
                <div className="inspector-power-row">
                  <span className="meta-label">POWER</span>
                  <span className="power-value">{hoveredCard.power}</span>
                </div>
              )}

              <div className="inspector-footer">
                <span className="set-id">{hoveredCard.id}</span>
                {hoveredCard.element && <span className={`element-tag ${hoveredCard.element.toLowerCase()}`}>{hoveredCard.element}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Left Column: Phase-Based Card Library */}
      <div className="card-library-section">
        
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
            <option value="SR">Silver Rare</option>
            <option value="SSR">Super Secret Rare</option>
          </select>
        </div>

        {loading ? (
          <div className="loading-sparkles">Gathering cards... ✨</div>
        ) : (
          <div className="card-grid">
            {buildPhase === 'STORY' ? (
              Object.entries(storyGroups).map(([groupKey, group]) => {
                const displayName = group[0]?.name ? group[0].name.split(/[-–]/)[0].trim() : groupKey;
                return (
                  <div 
                    key={groupKey} 
                    className="story-stack" 
                    onClick={() => addStoryGroup(group)}
                  >
                    {group.map((card) => (
                      <img 
                        key={card.id}
                        className="story-card-layer"
                        src={card.image_url} 
                        alt={card.name} 
                        onMouseEnter={() => handleMouseEnter(card)}
                        onMouseLeave={handleMouseLeave}
                      />
                    ))}
                    <div className="story-stack-label">{displayName} ({group.length}/4)</div>
                  </div>
                );
              })
            ) : (
              displayCards.map(card => (
                <div 
                  key={card.id} 
                  className="card-item" 
                  onClick={() => addCardToDeck(card)}
                  onMouseEnter={() => handleMouseEnter(card)}
                  onMouseLeave={handleMouseLeave}
                >
                  <img src={card.image_url} alt={card.name} loading="lazy" />
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Right Column: Active Deck */}
      <div className="deck-panel-section">
        <div className={`element-banner ${deckElement ? deckElement.toLowerCase() : 'unaligned'}`}>
          {deckElement ? `Current Element: ${deckElement}` : 'Awaiting Mane Character...'}
        </div>

        <div className="deck-meta-inputs">
          <input 
            type="text" 
            value={deckName} 
            onChange={e => setDeckName(e.target.value)} 
            placeholder="Name your deck!"
            className="deck-name-input input-bubble"
          />
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
      </div>
    </div>
  );
}