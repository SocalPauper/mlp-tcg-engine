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

interface DeckBuilderProps {
  deckId: string | null;
  mode: 'CREATE' | 'EDIT' | 'VIEW' | 'COPY';
  onClose: () => void;
}

export default function DeckBuilder({ deckId, mode, onClose }: DeckBuilderProps) {
  const [cards, setCards] = useState<Card[]>([]);
  
  // Progress & Inventory States
  const [unlockedCardIds, setUnlockedCardIds] = useState<string[]>([]);
  const [newlyUnlockedCards, setNewlyUnlockedCards] = useState<Card[]>([]);
  const [showUnlockModal, setShowUnlockModal] = useState(false);

  // Deck Structure States
  const [maneCharacter, setManeCharacter] = useState<Card | null>(null);
  const [storyDeck, setStoryDeck] = useState<Card[]>([]);
  const [sceneDeck, setSceneDeck] = useState<Card[]>([]);
  const [mainDeck, setMainDeck] = useState<Card[]>([]);
  
  const [buildPhase, setBuildPhase] = useState<BuildPhase>('MANE');
  const deckElement = maneCharacter?.element || null;
  
  // UI Meta States
  const [deckName, setDeckName] = useState('My Sparkle Deck');
  const [isPublic, setIsPublic] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRarity, setSelectedRarity] = useState<string | 'ALL'>('ALL');
  const [selectedMainType, setSelectedMainType] = useState<string | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);

  const [isStarter, setIsStarter] = useState(mode === 'VIEW');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');

  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

  // 1. Fetch entire card catalog
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

  // 2. Fetch User Inventory & New Alerts (Depends on cards being loaded)
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token && cards.length > 0) {
      fetch('https://mlp-tcg-engine.onrender.com/api/users/me/collection', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          // Map all owned cards for the lock logic
          const ownedIds = data.map((item: any) => item.card_id);
          setUnlockedCardIds(ownedIds);

          // Find cards the user hasn't been alerted about yet
          const unalertedItems = data.filter((item: any) => item.user_alerted === false);
          if (unalertedItems.length > 0) {
            const newCards = unalertedItems
              .map((item: any) => cards.find(c => c.id === item.card_id))
              .filter(Boolean) as Card[];
            
            if (newCards.length > 0) {
              setNewlyUnlockedCards(newCards);
              setShowUnlockModal(true);
            }
          }
        }
      })
      .catch(err => console.error('Failed to load collection:', err));
    }
  }, [cards]);

  // 3. Fetch existing deck data if editing/viewing
  useEffect(() => {
    if (deckId && cards.length > 0) {
      const token = localStorage.getItem('token');
      fetch(`https://mlp-tcg-engine.onrender.com/api/decks/${deckId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
        .then(res => {
          if (!res.ok) throw new Error('Deck not found');
          return res.json();
        })
        .then(deckData => {
          setDeckName(mode === 'COPY' ? `${deckData.name} (Copy)` : deckData.name);
          setIsPublic(deckData.is_public);
          setIsStarter(deckData.is_starter || mode === 'VIEW');
          
          if (deckData.mane_character) {
            const mane = cards.find(c => c.id === deckData.mane_character);
            if (mane) setManeCharacter(mane);
          }
          
          const hydrateCards = (idArray: string[]) => 
            idArray.map(id => cards.find(c => c.id === id)).filter(Boolean) as Card[];
            
          setStoryDeck(hydrateCards(deckData.story_deck || []));
          setSceneDeck(hydrateCards(deckData.scene_deck || []));
          setMainDeck(hydrateCards(deckData.main_deck || []));
          
          setBuildPhase('MAIN');
        })
        .catch(err => console.error('Error fetching deck:', err));
    }
  }, [deckId, cards, mode]);

  // --- Logic Helpers ---

  const handleAcknowledgeUnlocks = () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    // Acknowledge these cards on the backend so the modal doesn't pop up again
    fetch('https://mlp-tcg-engine.onrender.com/api/users/me/collection/acknowledge', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(() => {
      setShowUnlockModal(false);
      setNewlyUnlockedCards([]);
    })
    .catch(console.error);
  };

  const isCardLocked = (card: Card) => {
    // Starter Deck base cards are always free
    if (card.id.startsWith('SD01')) return false;

    // If the user owns it, it's unlocked
    if (unlockedCardIds.includes(card.id)) return false;

    // Otherwise, premium hits and alternates are locked by default
    const premiumRarities = ['RR', 'CR', 'GR', 'SPR'];
    if (premiumRarities.includes(card.rarity) || card.id.includes('-S')) return true;

    // Commons, Uncommons, SR, ER are base tiers (unlocked by default)
    return false;
  };

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
    if (isStarter) return;
    if (isCardLocked(card)) return alert('You must unlock this rare card from a pack first!');

    const baseId = card.id.replace('-S', '');

    if (buildPhase === 'MANE') {
      setManeCharacter(card);
      if (storyDeck.length === 0) setBuildPhase('STORY'); 
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
    } 
    else if (buildPhase === 'MAIN') {
      if (mainDeck.length >= 50) return alert('Main Deck is full (50/50).');
      const copies = mainDeck.filter(c => c.id.replace('-S', '') === baseId).length;
      if (copies >= 3) return alert('You can only have 3 copies of any card.');
      
      setMainDeck([...mainDeck, card]);
    }
  };

  const addStoryGroup = (group: Card[]) => {
    if (isStarter) return; 
    if (group.some(c => isCardLocked(c))) return alert('You must unlock this alternate art first!');
    if (storyDeck.length + group.length > 4) return alert('Story Deck can only hold 4 cards.');
    
    const newStoryDeck = [...storyDeck, ...group];
    setStoryDeck(newStoryDeck);
  };

  const removeCard = (zone: string, index: number) => {
    if (isStarter) return; 

    if (zone === 'mane') {
      const confirmReset = window.confirm('Removing your Mane Character will clear all other cards to prevent element conflicts. Continue?');
      if (confirmReset) {
        setManeCharacter(null);
        setStoryDeck([]);
        setSceneDeck([]);
        setMainDeck([]);
      }
    } else if (zone === 'story') {
      setStoryDeck([]);
    } else if (zone === 'scene') {
      setSceneDeck(sceneDeck.filter((_, i) => i !== index));
    } else if (zone === 'main') {
      setMainDeck(mainDeck.filter((_, i) => i !== index));
    }
  };

  const handleCopyDeck = () => {
    setIsStarter(false);
    setDeckName(`${deckName} (Copy)`);
    alert('Deck copied! You can now make changes and save it to your account.');
  };

  // --- Rendering Helpers ---

  const baseFilteredCards = cards.filter(card => {
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
      (c.element === 'Everyday' || !c.element || c.element === deckElement || !deckElement)
    );
  } else if (buildPhase === 'MAIN') {
    displayCards = baseFilteredCards.filter(c => {
      const isValidType = ['Character', 'Friend Character', 'Event', 'Item'].includes(c.card_type) && 
                          c.card_type !== 'Story' && 
                          !c.name.includes(' - ') && 
                          !c.name.includes(' – ');
      
      const matchesMainType = selectedMainType === 'ALL' || c.card_type === selectedMainType;
      const matchesElement = c.element === deckElement || !c.element || c.element === 'Everyday' || !deckElement;
      return isValidType && matchesMainType && matchesElement;
    });
  }

  const storyGroups: Record<string, Card[]> = {};
  const setBuckets: Record<string, Card[]> = {};
  displayCards.forEach(card => {
    const setCode = card.set_code || 'BP01';
    if (!setBuckets[setCode]) setBuckets[setCode] = [];
    setBuckets[setCode].push(card);
  });

  Object.entries(setBuckets).forEach(([setCode, setCardList]) => {
    const normalCards = setCardList.filter(c => !c.id.includes('-S')).sort((a, b) => a.id.localeCompare(b.id));
    const altCards = setCardList.filter(c => c.id.includes('-S')).sort((a, b) => a.id.localeCompare(b.id));
    
    const chunkArray = (arr: Card[], isAlt: boolean) => {
      for (let i = 0; i < arr.length; i += 4) {
        const chunk = arr.slice(i, i + 4);
        if (chunk.length === 0) continue;
        const baseName = chunk[0].name.split(/[-–]/)[0].trim();
        const groupKey = `${setCode}-Chunk-${Math.floor(i / 4)}-${baseName}${isAlt ? '-Alt' : ''}`;
        storyGroups[groupKey] = chunk;
      }
    };

    chunkArray(normalCards, false);
    chunkArray(altCards, true);
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
    
    const endpoint = (mode === 'EDIT' && deckId) ? `/api/decks/${deckId}` : '/api/decks';
    const method = (mode === 'EDIT' && deckId) ? 'PUT' : 'POST';

    fetch(`https://mlp-tcg-engine.onrender.com${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(deckPayload)
    })
    .then(res => res.json())
    .then(() => {
      alert('Deck successfully saved!');
      onClose(); 
    })
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

      {/* --- UNLOCK CELEBRATION MODAL --- */}
      {showUnlockModal && newlyUnlockedCards.length > 0 && (
        <div className="inspector-overlay" style={{ pointerEvents: 'auto', zIndex: 10000 }}>
          <div className="unlock-modal">
            <h2 className="unlock-title">✨ New Rares Unlocked! ✨</h2>
            <div className="unlocked-cards-grid">
              {newlyUnlockedCards.map(c => (
                <div key={c.id} className="unlocked-card-item">
                  <img src={c.image_url} alt={c.name} />
                </div>
              ))}
            </div>
            <button className="phase-btn active glow-btn" onClick={handleAcknowledgeUnlocks}>
              Awesome!
            </button>
          </div>
        </div>
      )}
      
      {/* Import Modal */}
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

      {/* Card Inspector Tooltip */}
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
              
              <div className="inspector-meta-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', margin: '15px 0' }}>
                <div className="meta-block">
                  <span className="meta-label" style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>TYPE</span>
                  <span className="meta-value" style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>{hoveredCard.card_type}</span>
                </div>
                <div className="meta-block">
                  <span className="meta-label" style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>RARITY</span>
                  <span className="meta-value" style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>{hoveredCard.rarity}</span>
                </div>
              </div>

              {hoveredCard.element && (
                <div className="inspector-meta-block" style={{ marginBottom: '15px' }}>
                  <span className="meta-label" style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>ELEMENT</span>
                  <span className="meta-value" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--mlp-pink)' }}>{hoveredCard.element}</span>
                </div>
              )}

              <div className="inspector-rules-text" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', marginBottom: '15px' }}>
                <span className="meta-label" style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '6px' }}>RULES TEXT</span>
                <p style={{ fontSize: '13px', color: '#ddd', lineHeight: '1.4', margin: 0 }}>
                  {hoveredCard.effect_text || (hoveredCard.id.includes('ER') ? 'Inspo Boost: Your matching characters get +1 Inspiration until the end of this contact.' : 'No abilities.')}
                </p>
              </div>

              {['Character', 'Friend Character'].includes(hoveredCard.card_type) && (
                <div className="inspector-power-row" style={{ marginBottom: '15px' }}>
                  <span className="meta-label" style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>POWER</span>
                  <span className="power-value" style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>{hoveredCard.power}</span>
                </div>
              )}

              <div className="inspector-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', borderTop: '1px solid #333', paddingTop: '12px' }}>
                <span className="set-id" style={{ fontSize: '12px', color: '#aaa', fontFamily: 'monospace' }}>{hoveredCard.id}</span>
                {hoveredCard.element && <span className={`element-tag ${hoveredCard.element.toLowerCase()}`} style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', background: '#333', color: '#fff' }}>{hoveredCard.element}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Library */}
      <div className="card-library-section">
        <div className="phase-tracker">
          <button className={`phase-btn ${buildPhase === 'MANE' ? 'active' : ''}`} onClick={() => setBuildPhase('MANE')}>1. Mane</button>
          <button className={`phase-btn ${buildPhase === 'STORY' ? 'active' : ''}`} onClick={() => setBuildPhase('STORY')}>2. Story</button>
          <button className={`phase-btn ${buildPhase === 'SCENE' ? 'active' : ''}`} onClick={() => setBuildPhase('SCENE')}>3. Scenes</button>
          <button className={`phase-btn ${buildPhase === 'MAIN' ? 'active' : ''}`} onClick={() => setBuildPhase('MAIN')}>4. Main Deck</button>
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
          <div className="card-grid" style={{ opacity: isStarter ? 0.5 : 1, pointerEvents: isStarter ? 'none' : 'auto' }}>
            {buildPhase === 'STORY' ? (
              Object.entries(storyGroups).map(([groupKey, group]) => {
                const displayName = group[0]?.name ? group[0].name.split(/[-–]/)[0].trim() : groupKey;
                const isLocked = group.some(c => isCardLocked(c));
                return (
                  <div 
                    key={groupKey} 
                    className={`story-stack ${isLocked ? 'locked' : ''}`} 
                    onClick={() => {
                      if (isLocked) alert('You must unlock this alternate art first!');
                      else addStoryGroup(group);
                    }}
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
                    {isLocked && <div className="lock-icon">🔒</div>}
                    <div className="story-stack-label">{displayName} {isLocked ? '(Locked)' : `(${group.length}/4)`}</div>
                  </div>
                );
              })
            ) : (
              displayCards.map(card => {
                const isLocked = isCardLocked(card);
                return (
                  <div 
                    key={card.id} 
                    className={`card-item ${isLocked ? 'locked' : ''}`} 
                    onClick={() => {
                      if (isLocked) alert('You must unlock this rare card from a pack first!');
                      else addCardToDeck(card);
                    }}
                    onContextMenu={(e) => handleContextMenu(e, card)}
                    onTouchStart={() => handleTouchStart(card)}
                    onTouchEnd={handleTouchEnd}
                  >
                    <img src={card.image_url} alt={card.name} loading="lazy" />
                    {isLocked && <div className="lock-icon">🔒</div>}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className="deck-panel-section">
        <button 
          onClick={onClose} 
          style={{ 
            background: 'rgba(156, 39, 176, 0.1)', 
            color: 'var(--mlp-purple)', 
            border: '2px solid var(--mlp-purple)', 
            padding: '8px 16px', 
            borderRadius: '12px', 
            fontWeight: 'bold', 
            cursor: 'pointer', 
            marginBottom: '16px',
            alignSelf: 'flex-start'
          }}
        >
          🔙 Return to Stable
        </button>

        {isStarter && (
          <div style={{ background: 'var(--mlp-purple)', color: 'white', padding: '12px', borderRadius: '12px', textAlign: 'center', fontWeight: 'bold', marginBottom: '16px', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
            This deck is Read-Only. <br/>
            <span style={{ fontSize: '13px', fontWeight: 'normal' }}>Copy it to make changes.</span>
          </div>
        )}

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
            disabled={isStarter}
          />
        </div>

        <div className="deck-visibility-bar">
          <label className="visibility-switch">
            <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} disabled={isStarter} />
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
                 {!isStarter && <span className="remove-tag">✕</span>}
               </div>
            ) : <div className="empty-zone">Select a Mane Character</div>}
          </div>

          <div className="deck-zone">
            <h3>Story Deck ({storyDeck.length}/4)</h3>
            {storyDeck.length > 0 ? (
              storyDeck.map((c, i) => (
                <div key={i} className="deck-row" onClick={() => removeCard('story', i)}>
                  <span>{c.name}</span>{!isStarter && <span className="remove-tag">✕</span>}
                </div>
              ))
            ) : <div className="empty-zone">Select Story Cards</div>}
          </div>

          <div className="deck-zone">
            <h3>Scene Deck ({sceneDeck.length}/15)</h3>
            {sceneDeck.map((c, i) => (
              <div key={i} className="deck-row" onClick={() => removeCard('scene', i)}>
                <span>{c.name}</span>{!isStarter && <span className="remove-tag">✕</span>}
              </div>
            ))}
          </div>

          <div className="deck-zone main-deck-zone">
            <h3>Main Deck ({mainDeck.length}/50)</h3>
            {mainDeck.map((c, i) => (
              <div key={i} className="deck-row" onClick={() => removeCard('main', i)}>
                <span>{c.name}</span>{!isStarter && <span className="remove-tag">✕</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="deck-actions-bar">
          {isStarter ? (
            <button className="action-btn save-btn" onClick={handleCopyDeck} style={{ background: 'var(--mlp-pink)' }}>Copy to Edit 📝</button>
          ) : (
            <>
              <button className="action-btn save-btn" onClick={handleSaveDeck}>Save 💾</button>
              <button className="action-btn import-btn" onClick={() => setImportModalOpen(true)}>Import 📥</button>
            </>
          )}
          <button className="action-btn export-btn" onClick={handleExportDeck}>Export 📤</button>
        </div>

      </div>
    </div>
  );
}