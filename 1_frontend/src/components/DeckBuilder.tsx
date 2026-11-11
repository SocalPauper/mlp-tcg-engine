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

export default function DeckBuilder() {
  const [cards, setCards] = useState<Card[]>([]);
  
  // Strict Deck Zones
  const [maneCharacter, setManeCharacter] = useState<Card | null>(null);
  const [storyDeck, setStoryDeck] = useState<Card[]>([]);
  const [sceneDeck, setSceneDeck] = useState<Card[]>([]);
  const [mainDeck, setMainDeck] = useState<Card[]>([]);
  
  const [deckName, setDeckName] = useState('My Sparkle Deck');
  const [isPublic, setIsPublic] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedElement, setSelectedElement] = useState<string | 'ALL'>('ALL');
  const [selectedRarity, setSelectedRarity] = useState<string | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Hover Inspector State
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const elements = ['Magic', 'Honesty', 'Kindness', 'Laughter', 'Generosity', 'Loyalty'];

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
    if (card.card_type === 'Mane Character') {
      setManeCharacter(card);
    } else if (card.card_type === 'Story') {
      if (storyDeck.length < 4) setStoryDeck([...storyDeck, card]);
      else alert('Your Story Deck has reached its 4-card limit.');
    } else if (card.card_type === 'Scene') {
      if (sceneDeck.length < 15) setSceneDeck([...sceneDeck, card]);
      else alert('Your Scene Deck has reached its 15-card limit.');
    } else {
      if (mainDeck.length < 50) setMainDeck([...mainDeck, card]);
      else alert('Your Main Deck has reached its 50-card limit.');
    }
  };

  const removeCard = (zone: string, index: number) => {
    if (zone === 'mane') setManeCharacter(null);
    if (zone === 'story') setStoryDeck(storyDeck.filter((_, i) => i !== index));
    if (zone === 'scene') setSceneDeck(sceneDeck.filter((_, i) => i !== index));
    if (zone === 'main') setMainDeck(mainDeck.filter((_, i) => i !== index));
  };

  const clearDeck = () => {
    setManeCharacter(null);
    setStoryDeck([]);
    setSceneDeck([]);
    setMainDeck([]);
  };

  const saveDeckToBackend = async () => {
    if (!deckName.trim()) return alert('Please enter a deck name.');
    if (!maneCharacter && mainDeck.length === 0) return alert('Cannot save an empty deck.');

    setSaving(true);
    try {
      const payload = {
        id: 'deck-' + Date.now(),
        name: deckName,
        isPublic,
        mane: maneCharacter,
        stories: storyDeck,
        scenes: sceneDeck,
        main: mainDeck
      };

      const res = await fetch('https://mlp-tcg-engine.onrender.com/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) alert('Deck saved successfully!');
      else alert('Failed to save deck.');
    } catch (err) {
      console.error(err);
      alert('Network error while saving deck.');
    } finally {
      setSaving(false);
    }
  };

  const filteredCards = cards.filter(card => {
    const matchesSearch = card.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          card.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesElement = selectedElement === 'ALL' || card.element === selectedElement;
    const matchesRarity = selectedRarity === 'ALL' || card.rarity === selectedRarity;
    return matchesSearch && matchesElement && matchesRarity;
  });

  const totalCards = (maneCharacter ? 1 : 0) + storyDeck.length + sceneDeck.length + mainDeck.length;

  return (
    <div className="deck-builder-container" onMouseMove={handleMouseMove}>
      
      {/* Floating Inspector Popup */}
      {hoveredCard && (
        <div 
          className="card-popup" 
          style={{ left: mousePos.x + 20, top: mousePos.y + 20 }}
        >
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
                <div className={`stat-box element-box ${hoveredCard.element.toLowerCase()}`}>
                  {hoveredCard.element}
                </div>
              )}
            </div>

            <div className="popup-effect">
              {hoveredCard.effect_text || 'No effect.'}
            </div>
            <div className="popup-traits">Traits: {hoveredCard.traits || 'None'}</div>
          </div>
        </div>
      )}

      {/* Left Column: Card Library */}
      <div className="card-library-section">
        <h2 className="section-title">Collection</h2>
        
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
            <option value="C">Common (C)</option>
            <option value="U">Uncommon (U)</option>
            <option value="SR">Silver Rare (SR)</option>
            <option value="SPR">Sapphire Rare (SPR)</option>
            <option value="CR">Colorful Rare (CR)</option>
            <option value="GR">Gold Rare (GR)</option>
            <option value="RR">Ruby Rare (RR)</option>
          </select>
        </div>

        <div className="element-filters">
          <button 
            className={`element-btn all-elements ${selectedElement === 'ALL' ? 'active' : ''}`}
            onClick={() => setSelectedElement('ALL')}
          >
            All
          </button>
          {elements.map(el => (
            <button 
              key={el}
              className={`element-btn ${el.toLowerCase()} ${selectedElement === el ? 'active' : ''}`}
              onClick={() => setSelectedElement(el)}
            >
              {el}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="loading-sparkles">Gathering cards... ✨</div>
        ) : (
          <div className="card-grid">
            {filteredCards.map(card => (
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
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.onerror = null; 
                    target.src = '/placeholder-card.png'; // Add a cute placeholder image here later
                  }} 
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right Column: Active Deck */}
      <div className="deck-panel-section">
        <h2 className="section-title">Your Deck</h2>
        
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
          <button onClick={clearDeck} className="clear-deck-btn">Reset Deck</button>
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

        <button onClick={saveDeckToBackend} disabled={saving} className="save-deck-btn bubble-btn">
          {saving ? 'Saving...' : '✨ Save Deck ✨'}
        </button>
      </div>
    </div>
  );
}