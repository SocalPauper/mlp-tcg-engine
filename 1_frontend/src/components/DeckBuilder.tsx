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
  const [isPublic, setIsPublic] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRarity, setSelectedRarity] = useState<string | 'ALL'>('ALL');
  const [selectedMainType, setSelectedMainType] = useState<string | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');

  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

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

  const handleContextMenu = (e: React.MouseEvent, card: Card) => {
    e.preventDefault();
    setHoveredCard(card);
  };

  const handleTouchStart = (card: Card) => {
    longPressTimer.current = setTimeout(() => {
      setHoveredCard(card);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
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
      const isEveryday = card.element === 'Everyday' || !card.element;

      if (!isEveryday && copies >= 3) {
        return alert('You can only have up to 3 copies of an element-specific Scene.');
      }
      
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
    const newStoryDeck = [...storyDeck, ...group];
    setStoryDeck(newStoryDeck);
    if (newStoryDeck.length === 4) setBuildPhase('SCENE'); 
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
    } else if (zone === 'story') {
      setStoryDeck([]);
      setSceneDeck([]);
      setMainDeck([]);
      setBuildPhase('STORY');
    } else if (zone === 'scene') {
      setSceneDeck(sceneDeck.filter((_, i) => i !== index));
      if (sceneDeck.length - 1 < 15 && buildPhase === 'MAIN') {
        setBuildPhase('SCENE');
      }
    } else if (zone === 'main') {
      setMainDeck(mainDeck.filter((_, i) => i !== index));
    }
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
    // STRICT ELEMENT FILTER FOR SCENES: Only Everyday, NULL, or matching deckElement
    displayCards = baseFilteredCards.filter(c => 
      c.card_type === 'Scene' && 
      (c.element === 'Everyday' || !c.element || c.element === deckElement)
    );
  } else if (buildPhase === 'MAIN') {
    displayCards = baseFilteredCards.filter(c => {
      const isValidType = ['Character', 'Friend Character', 'Event', 'Item'].includes(c.card_type) && 
                          c.card_type !== 'Story' && 
                          !c.name.includes(' - ') && 
                          !c.name.includes(' – ');
      
      const matchesMainType = selectedMainType === 'ALL' || c.card_type === selectedMainType;
      const matchesElement = c.element === deckElement || !c.element || c.element === 'Everyday';
      return isValidType && matchesMainType && matchesElement;
    });
  }

// UNIVERSAL CHUNKED STORY GROUPING: Groups story cards by set code, chunking every 4 sequential cards together
  const storyGroups: Record<string, Card[]> = {};
  
  // Group display cards by set_code first
  const setBuckets: Record<string, Card[]> = {};
  displayCards.forEach(card => {
    const setCode = card.set_code || 'BP01';
    if (!setBuckets[setCode]) setBuckets[setCode] = [];
    setBuckets[setCode].push(card);
  });

  // For each set, sort cards by ID and chunk into groups of 4
  Object.entries(setBuckets).forEach(([setCode, setCardList]) => {
    const sorted = setCardList.sort((a, b) => a.id.localeCompare(b.id));
    
    for (let i = 0; i < sorted.length; i += 4) {
      const chunk = sorted.slice(i, i + 4);
      const baseName = chunk[0].name.split(/[-–]/)[0].trim();
      const groupKey = `${setCode}-Chunk-${Math.floor(i / 4)}-${baseName}`;
      storyGroups[groupKey] = chunk;
    }
  });

  const totalCards = (maneCharacter ? 1 : 0) + storyDeck.length + sceneDeck.length + mainDeck.length;

  const handleSaveDeck = () => {
    const token = localStorage.getItem('token');
    if (!token) {
      return alert('You must be signed in to save your deck to your account.');
    }
    const deckPayload = {
      name: deckName,
      is_public: isPublic,
      mane_character: maneCharacter?.id,
      story_deck: storyDeck.map(c => c.id),
      scene_deck: sceneDeck.map(c => c.id),
      main_deck: mainDeck.map(c => c.id)
    };
    fetch('https://mlp-tcg-engine.onrender.com/api/decks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(deckPayload)
    })
    .then(res => res.json())
    .then(() => alert('Deck successfully saved to your account!'))
    .catch(() => alert('Failed to save deck.'));
  };

  const handleExportDeck = () => {
    const exportList = [
      `// Deck: ${deckName}`,
      `Mane: ${maneCharacter ? maneCharacter.id : 'None'}`,
      `--- Story (${storyDeck.length}) ---`,
      ...storyDeck.map(c => `1x ${c.id} ${c.name}`),
      `--- Scene (${sceneDeck.length}) ---`,
      ...sceneDeck.map(c => `1x ${c.id} ${c.name}`),
      `--- Main (${mainDeck.length}) ---`,
      ...mainDeck.map(c => `1x ${c.id} ${c.name}`)
    ].join('\n');
    navigator.clipboard.writeText(exportList);
    alert('Decklist copied to clipboard in standard Kayou format!');
  };

  const handleImportDeck = () => {
    const lines = importText.split('\n');
    let foundMane: Card | null = null;
    const foundStories: Card[] = [];
    const foundScenes: Card[] = [];
    const foundMains: Card[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('---')) continue;
      
      const match = trimmed.match(/^(?:(\d+)x?\s+)?([A-Z0-9-]+)\s+(.*)$/i) || trimmed.match(/^([A-Z0-9-]+)\s+(.*)$/i);
      if (match) {
        const cardId = match[2] || match[1];
        const qty = match[1] && !isNaN(Number(match[1])) ? parseInt(match[1], 10) : 1;
        const cardObj = cards.find(c => c.id.toLowerCase() === cardId.toLowerCase());
        if (cardObj) {
          if (cardObj.card_type === 'Mane Character') foundMane = cardObj;
          else if (cardObj.card_type === 'Story') foundStories.push(cardObj);
          else if (cardObj.card_type === 'Scene') {
            for (let i = 0; i < qty; i++) foundScenes.push(cardObj);
          } else {
            for (let i = 0; i < qty; i++) foundMains.push(cardObj);
          }
        }
      }
    }

    if (foundMane) setManeCharacter(foundMane);
    if (foundStories.length > 0) setStoryDeck(foundStories.slice(0, 4));
    if (foundScenes.length > 0) setSceneDeck(foundScenes.slice(0, 15));
    if (foundMains.length > 0) setMainDeck(foundMains.slice(0, 50));

    setImportModalOpen(false);
    setImportText('');
    setBuildPhase('MAIN');
    alert('Deck successfully imported!');
  };

  return (
    <div className="deck-builder-container">
      
      {importModalOpen && (
        <div className="inspector-overlay" style={{ pointerEvents: 'auto' }}>
          <div className="inspector-modal" style={{ flexDirection: 'column', padding: '30px', height: 'auto', width: '500px' }}>
            <h2 style={{ color: '#fff', marginBottom: '15px' }}>Import Decklist</h2>
            <textarea 
              rows={10} 
              value={importText} 
              onChange={e => setImportText(e.target.value)}
              placeholder="Paste deck list here..."
              style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#222831', color: '#fff', border: '1px solid #444', marginBottom: '15px' }}
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button className="phase-btn" onClick={() => setImportModalOpen(false)}>Cancel</button>
              <button className="phase-btn active" onClick={handleImportDeck}>Import</button>
            </div>
          </div>
        </div>
      )}

      {/* CLEANED UP INSPECTOR POPUP WITH CLEAR LABEL/DATA DIVISIONS */}
      {hoveredCard && (
        <div className="inspector-overlay" style={{ pointerEvents: 'auto' }}>
          <div className="inspector-modal">
            <button className="inspector-close-btn" onClick={() => setHoveredCard(null)}>✕</button>
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

              {hoveredCard.element && (
                <div className="inspector-meta-row" style={{ marginTop: '-10px' }}>
                  <div className="meta-block">
                    <span className="meta-label">ELEMENT</span>
                    <span className="meta-value element-badge-text" style={{ color: 'var(--mlp-pink)' }}>{hoveredCard.element}</span>
                  </div>
                </div>
              )}

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
          {buildPhase === 'MAIN' && (
            <select value={selectedMainType} onChange={e => setSelectedMainType(e.target.value)} className="rarity-select input-bubble">
              <option value="ALL">All Types</option>
              <option value="Character">Character</option>
              <option value="Friend Character">Friend Character</option>
              <option value="Event">Event</option>
              <option value="Item">Item</option>
            </select>
          )}
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
                    onContextMenu={(e) => handleContextMenu(e, group[0])}
                    onTouchStart={() => handleTouchStart(group[0])}
                    onTouchEnd={handleTouchEnd}
                  >
                    {group.map((card) => (
                      <img 
                        key={card.id}
                        className="story-card-layer"
                        src={card.image_url} 
                        alt={card.name} 
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
                  onContextMenu={(e) => handleContextMenu(e, card)}
                  onTouchStart={() => handleTouchStart(card)}
                  onTouchEnd={handleTouchEnd}
                >
                  <img src={card.image_url} alt={card.name} loading="lazy" />
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="deck-panel-section">
        
        <div className={`decorated-element-banner ${deckElement ? deckElement.toLowerCase() : 'unaligned'}`}>
          <div className="banner-glow-effect"></div>
          <span className="banner-star">✨</span>
          <span className="banner-text">{deckElement ? `Current Element: ${deckElement}` : 'Awaiting Mane Character...'}</span>
          <span className="banner-star">✨</span>
        </div>

        <div className="deck-name-container">
          <label className="deck-name-label">Deck Name ✏️</label>
          <input 
            type="text" 
            value={deckName} 
            onChange={e => setDeckName(e.target.value)} 
            placeholder="Name your deck!"
            className="deck-name-input input-bubble"
          />
        </div>

        <div className="deck-visibility-bar">
          <label className="visibility-switch">
            <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
            <span className="slider round"></span>
          </label>
          <span className="visibility-label">{isPublic ? 'Public Deck 🌍' : 'Private Deck 🔒'}</span>
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

          <div className="deck-zone" onClick={() => storyDeck.length > 0 && removeCard('story', 0)}>
            <h3>Story Deck ({storyDeck.length}/4)</h3>
            {storyDeck.length > 0 ? (
              storyDeck.map((c, i) => (
                <div key={i} className="deck-row">
                  <span>{c.name}</span>{i === storyDeck.length - 1 && <span className="remove-tag">✕</span>}
                </div>
              ))
            ) : <div className="empty-zone">Select Story Cards</div>}
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

        <div className="deck-actions-bar">
          <button className="action-btn save-btn" onClick={handleSaveDeck}>Save Deck 💾</button>
          <button className="action-btn import-btn" onClick={() => setImportModalOpen(true)}>Import 📥</button>
          <button className="action-btn export-btn" onClick={handleExportDeck}>Export 📤</button>
        </div>

      </div>
    </div>
  );
}