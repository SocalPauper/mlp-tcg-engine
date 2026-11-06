import React, { useState, useEffect } from 'react';

interface Card {
  id: string;
  name: string;
  set_code: string;
  card_type: string;
  rarity: string;
  cost: number;
  power: number;
  defense: number;
  traits: string;
  effect_text: string;
  image_url: string;
}

export default function DeckBuilder() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  // Deck State
  const [selectedMane, setSelectedMane] = useState<Card | null>(null);
  const [selectedStories, setSelectedStories] = useState<Card[]>([]);
  const [selectedScenes, setSelectedScenes] = useState<Card[]>([]);
  const [mainDeck, setMainDeck] = useState<Card[]>([]);
  const [activeTab, setActiveTab] = useState<'mane' | 'stories' | 'scenes' | 'main'>('mane');

  useEffect(() => {
    fetch('/api/cards')
      .then((res) => res.json())
      .then((data) => {
        setCards(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load cards', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-white">Loading Card Database...</div>;
  }

  // 1. Filter Mane Characters
  const maneCharacters = cards.filter(
    (card) => card.card_type === 'Character' && card.rarity === 'Mane'
  );

  // 2. Filter & Group Stories into Arcs of 4
  const storyCards = cards.filter((card) => card.name.toLowerCase().includes('story'));
  const groupedStoryArcs: { [key: string]: Card[] } = {};
  storyCards.forEach((card) => {
    const arcKey = card.name.replace(/\b(1|2|3|4|I|II|III|IV)\b/g, '').trim();
    if (!groupedStoryArcs[arcKey]) groupedStoryArcs[arcKey] = [];
    groupedStoryArcs[arcKey].push(card);
  });

  // 3. Filter Scene Cards
  const sceneCards = cards.filter(
    (card) => card.card_type === 'Scene' || card.set_code?.startsWith('ER')
  );

  // 4. Filter Main Deck Pool based on Mane Character attributes/traits
  const getLegalMainDeckCards = () => {
    return cards.filter((card) => {
      if (card.card_type === 'Character' && card.rarity === 'Mane') return false;
      if (card.name.toLowerCase().includes('story')) return false;
      if (card.card_type === 'Scene' || card.set_code?.startsWith('ER')) return false;

      if (!selectedMane) return true; // Show all if no mane selected yet
      return card.traits.split(', ').some((trait) => selectedMane.traits.includes(trait));
    });
  };

  const toggleStoryArc = (arcCards: Card[]) => {
    const isSelected = selectedStories.some((s) => arcCards.some((ac) => ac.id === s.id));
    if (isSelected) {
      setSelectedStories([]);
    } else {
      setSelectedStories(arcCards.slice(0, 4)); // Enforce exactly 4
    }
  };

  const toggleScene = (card: Card) => {
    if (selectedScenes.some((s) => s.id === card.id)) {
      setSelectedScenes(selectedScenes.filter((s) => s.id !== card.id));
    } else {
      if (selectedScenes.length < 15) {
        setSelectedScenes([...selectedScenes, card]);
      }
    }
  };

  const toggleMainDeckCard = (card: Card) => {
    setMainDeck([...mainDeck, card]);
  };

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      {/* Sidebar Deck Summary */}
      <div className="w-80 bg-gray-800 p-4 border-r border-gray-700 flex flex-col justify-between">
        <div>
          <h2 className="text-xl font-bold mb-4 text-pink-400">Deck Builder</h2>
          <div className="space-y-3 text-sm">
            <div className="p-2 bg-gray-700 rounded">
              <span className="font-semibold">Mane Character:</span>{' '}
              {selectedMane ? selectedMane.name : 'None Selected'}
            </div>
            <div className="p-2 bg-gray-700 rounded">
              <span className="font-semibold">Story Arc (4 req):</span>{' '}
              {selectedStories.length > 0 ? 'Selected (4/4)' : 'None Selected'}
            </div>
            <div className="p-2 bg-gray-700 rounded">
              <span className="font-semibold">Scenes:</span> {selectedScenes.length} / 15
            </div>
            <div className="p-2 bg-gray-700 rounded">
              <span className="font-semibold">Main Deck:</span> {mainDeck.length} cards
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-col space-y-2 mt-4">
          <button
            onClick={() => setActiveTab('mane')}
            className={`p-2 rounded text-left ${activeTab === 'mane' ? 'bg-pink-600' : 'bg-gray-700'}`}
          >
            1. Mane Character
          </button>
          <button
            onClick={() => setActiveTab('stories')}
            className={`p-2 rounded text-left ${activeTab === 'stories' ? 'bg-pink-600' : 'bg-gray-700'}`}
          >
            2. Story Arcs
          </button>
          <button
            onClick={() => setActiveTab('scenes')}
            className={`p-2 rounded text-left ${activeTab === 'scenes' ? 'bg-pink-600' : 'bg-gray-700'}`}
          >
            3. Scene Cards ({selectedScenes.length}/15)
          </button>
          <button
            onClick={() => setActiveTab('main')}
            className={`p-2 rounded text-left ${activeTab === 'main' ? 'bg-pink-600' : 'bg-gray-700'}`}
          >
            4. Attribute Card Pool
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-6 overflow-y-auto">
        {activeTab === 'mane' && (
          <div>
            <h3 className="text-2xl font-bold mb-4">Choose Your Mane Character</h3>
            <div className="grid grid-cols-4 gap-4">
              {maneCharacters.map((card) => (
                <div
                  key={card.id}
                  onClick={() => setSelectedMane(card)}
                  className={`border-2 rounded-lg p-2 cursor-pointer bg-gray-800 ${
                    selectedMane?.id === card.id ? 'border-pink-500 shadow-lg' : 'border-transparent'
                  }`}
                >
                  <img
                    src={card.image_url || '/assets/default-card-back.webp'}
                    alt={card.name}
                    className="w-full h-64 object-cover rounded mb-2"
                    onError={(e) => {
                      e.currentTarget.src = '/assets/default-card-back.webp';
                    }}
                  />
                  <h4 className="font-bold text-sm truncate">{card.name}</h4>
                  <p className="text-xs text-gray-400">Traits: {card.traits}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'stories' && (
          <div>
            <h3 className="text-2xl font-bold mb-4">Select a Story Arc (Set of 4)</h3>
            <div className="grid grid-cols-2 gap-6">
              {Object.entries(groupedStoryArcs).map(([arcName, arcCards]) => {
                const isSelected = selectedStories.some((s) => arcCards.some((ac) => ac.id === s.id));
                return (
                  <div
                    key={arcName}
                    onClick={() => toggleStoryArc(arcCards)}
                    className={`border-2 rounded-lg p-4 cursor-pointer bg-gray-800 ${
                      isSelected ? 'border-pink-500 bg-gray-700' : 'border-transparent'
                    }`}
                  >
                    <h4 className="font-bold text-lg mb-2 text-pink-300">{arcName} Arc</h4>
                    <div className="grid grid-cols-4 gap-2">
                      {arcCards.map((card) => (
                        <img
                          key={card.id}
                          src={card.image_url || '/assets/default-card-back.webp'}
                          alt={card.name}
                          className="w-full h-32 object-cover rounded"
                          onError={(e) => {
                            e.currentTarget.src = '/assets/default-card-back.webp';
                          }}
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
            <h3 className="text-2xl font-bold mb-4">
              Select Scene Cards ({selectedScenes.length} / 15 Required)
            </h3>
            <div className="grid grid-cols-5 gap-4">
              {sceneCards.map((card) => {
                const isSelected = selectedScenes.some((s) => s.id === card.id);
                return (
                  <div
                    key={card.id}
                    onClick={() => toggleScene(card)}
                    className={`border-2 rounded-lg p-2 cursor-pointer bg-gray-800 relative ${
                      isSelected ? 'border-pink-500 opacity-90' : 'border-transparent'
                    }`}
                  >
                    {isSelected && (
                      <span className="absolute top-3 right-3 bg-pink-600 text-xs px-2 py-1 rounded-full font-bold">
                        Selected
                      </span>
                    )}
                    <img
                      src={card.image_url || '/assets/default-card-back.webp'}
                      alt={card.name}
                      className="w-full h-56 object-cover rounded mb-2"
                      onError={(e) => {
                        e.currentTarget.src = '/assets/default-card-back.webp';
                      }}
                    />
                    <h4 className="font-bold text-xs truncate">{card.name}</h4>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'main' && (
          <div>
            <h3 className="text-2xl font-bold mb-4">Attribute-Filtered Card Pool</h3>
            <p className="text-sm text-gray-400 mb-4">
              Showing legal cards matching Mane Character attributes:{' '}
              <span className="text-pink-400 font-semibold">
                {selectedMane ? selectedMane.traits : 'None (Showing All)'}
              </span>
            </p>
            <div className="grid grid-cols-5 gap-4">
              {getLegalMainDeckCards().map((card) => (
                <div
                  key={card.id}
                  onClick={() => toggleMainDeckCard(card)}
                  className="border-2 border-transparent hover:border-pink-500 rounded-lg p-2 cursor-pointer bg-gray-800"
                >
                  <img
                    src={card.image_url || '/assets/default-card-back.webp'}
                    alt={card.name}
                    className="w-full h-56 object-cover rounded mb-2"
                    onError={(e) => {
                      e.currentTarget.src = '/assets/default-card-back.webp';
                    }}
                  />
                  <h4 className="font-bold text-xs truncate">{card.name}</h4>
                  <p className="text-xs text-gray-400">Cost: {card.cost} | Traits: {card.traits}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}