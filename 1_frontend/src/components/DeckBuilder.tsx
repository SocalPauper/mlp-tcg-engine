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
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'hub' | 'editor'>('hub');

  // Deck Hub State
  const [decks, setDecks] = useState<Deck[]>([
    {
      id: '1',
      name: 'Harmony Starters',
      author: 'Jesse',
      isPublic: true,
      mane: null,
      stories: [],
      scenes: [],
      main: [],
    },
  ]);

  // Active Deck Editor State
  const [activeDeck, setActiveDeck] = useState<Deck>({
    id: '',
    name: 'New Custom Deck',
    author: 'Jesse',
    isPublic: false,
    mane: null,
    stories: [],
    scenes: [],
    main: [],
  });

  const [activeTab, setActiveTab] = useState<'mane' | 'stories' | 'scenes' | 'main'>('mane');
  const [importExportText, setImportExportText] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);

  useEffect(() => {
    // Fetch cards from your backend/API endpoint connected to PostgreSQL
    fetch('/api/cards')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch cards');
        return res.json();
      })
      .then((data) => {
        setCards(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error loading card database:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-pink-400 text-xl font-bold">
        Loading Equestria Clash Card Database...
      </div>
    );
  }

  // --- Filtering Helpers ---
  const maneCharacters = cards.filter(
    (c) => c.card_type === 'Character' && c.rarity === 'Mane'
  );

  const storyCards = cards.filter((c) => c.name?.toLowerCase().includes('story'));
  const groupedStoryArcs: { [key: string]: Card[] } = {};
  storyCards.forEach((c) => {
    const arcKey = c.name.replace(/\b(1|2|3|4|I|II|III|IV)\b/g, '').trim();
    if (!groupedStoryArcs[arcKey]) groupedStoryArcs[arcKey] = [];
    groupedStoryArcs[arcKey].push(c);
  });

  const sceneCards = cards.filter(
    (c) => c.card_type === 'Scene' || c.set_code?.startsWith('ER')
  );

  const getLegalMainDeckCards = () => {
    return cards.filter((c) => {
      if (c.card_type === 'Character' && c.rarity === 'Mane') return false;
      if (c.name?.toLowerCase().includes('story')) return false;
      if (c.card_type === 'Scene' || c.set_code?.startsWith('ER')) return false;
      if (!activeDeck.mane) return true;
      return c.traits?.split(', ').some((t) => activeDeck.mane?.traits.includes(t));
    });
  };

  // --- Handlers ---
  const handleCreateNewDeck = () => {
    setActiveDeck({
      id: Date.now().toString(),
      name: 'My Custom Deck',
      author: 'Jesse',
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

  const handleSaveDeck = () => {
    const existingIndex = decks.findIndex((d) => d.id === activeDeck.id);
    if (existingIndex >= 0) {
      const updated = [...decks];
      updated[existingIndex] = activeDeck;
      setDecks(updated);
    } else {
      setDecks([...decks, activeDeck]);
    }
    alert('Deck saved successfully!');
    setView('hub');
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
      alert('Deck imported successfully!');
    } catch (e) {
      alert('Invalid JSON format for deck import.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col font-sans">
      {/* Top Header Bar matching your navigation */}
      <header className="bg-gray-800 border-b border-purple-900 px-6 py-4 flex justify-between items-center shadow-lg">
        <div>
          <h1 className="text-xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-400">
            Equestria Clash TCG
          </h1>
          <p className="text-xs text-gray-400">KAYOU MLP ONLINE ENGINE</p>
        </div>
        <div className="flex items-center space-x-4">
          {view === 'editor' && (
            <button
              onClick={() => setView('hub')}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-sm font-semibold rounded-lg transition"
            >
              ← Back to Deck Hub
            </button>
          )}
          <span className="text-sm bg-purple-900/50 border border-purple-700 px-3 py-1.5 rounded-full text-purple-300">
            Jesse
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {view === 'hub' ? (
          /* --- DECK HUB VIEW --- */
          <div>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-3xl font-bold text-white">Deck Management Hub</h2>
                <p className="text-gray-400 text-sm">
                  Browse community public decks or manage and build your own custom deck configurations.
                </p>
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={handleCreateNewDeck}
                  className="px-5 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 font-bold rounded-xl shadow-lg transition"
                >
                  + Create New Deck
                </button>
                <button
                  onClick={() => {
                    setImportExportText('');
                    setShowImportModal(true);
                  }}
                  className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 font-semibold rounded-xl transition text-sm"
                >
                  Import Deck JSON
                </button>
              </div>
            </div>

            {/* Decks Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {decks.map((deck) => (
                <div
                  key={deck.id}
                  className="bg-gray-800/80 border border-gray-700/80 rounded-2xl p-5 shadow-xl flex flex-col justify-between hover:border-pink-500/50 transition"
                >
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-xl font-bold text-pink-300">{deck.name}</h3>
                      <span
                        className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                          deck.isPublic
                            ? 'bg-green-900/50 text-green-300 border border-green-700'
                            : 'bg-yellow-900/50 text-yellow-300 border border-yellow-700'
                        }`}
                      >
                        {deck.isPublic ? 'Public' : 'Private'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mb-4">Author: {deck.author}</p>
                    <div className="space-y-2 text-sm bg-gray-900/50 p-3 rounded-xl border border-gray-800">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Mane Character:</span>
                        <span className="font-medium text-white">
                          {deck.mane ? deck.mane.name : 'None'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Story Arcs:</span>
                        <span className="font-medium text-white">
                          {deck.stories.length > 0 ? '4 / 4' : '0 / 4'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Scenes:</span>
                        <span className="font-medium text-white">{deck.scenes.length} / 15</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Main Deck:</span>
                        <span className="font-medium text-white">{deck.main.length} cards</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 flex space-x-3">
                    <button
                      onClick={() => handleEditDeck(deck)}
                      className="flex-1 py-2 bg-purple-600 hover:bg-purple-500 font-semibold rounded-xl text-sm transition text-center"
                    >
                      Edit Deck
                    </button>
                    <button
                      onClick={() => {
                        setActiveDeck(deck);
                        handleExportDeck();
                      }}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 font-semibold rounded-xl text-sm transition"
                    >
                      Export
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* --- DECK BUILDER EDITOR VIEW --- */
          <div className="flex flex-col lg:flex-row gap-8">
            {/* Sidebar Summary & Controls */}
            <div className="w-full lg:w-80 bg-gray-800/90 border border-gray-700 rounded-2xl p-5 shadow-xl flex flex-col justify-between h-fit">
              <div>
                <div className="mb-4">
                  <label className="text-xs text-gray-400 uppercase font-semibold">Deck Name</label>
                  <input
                    type="text"
                    value={activeDeck.name}
                    onChange={(e) => setActiveDeck({ ...activeDeck, name: e.target.value })}
                    className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-white font-bold focus:outline-none focus:border-pink-500"
                  />
                </div>

                {/* Public / Private Toggle */}
                <div className="mb-4 flex items-center justify-between bg-gray-900/60 p-3 rounded-xl border border-gray-700">
                  <span className="text-sm font-semibold text-gray-300">Visibility:</span>
                  <button
                    onClick={() => setActiveDeck({ ...activeDeck, isPublic: !activeDeck.isPublic })}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                      activeDeck.isPublic
                        ? 'bg-green-600 text-white'
                        : 'bg-yellow-600 text-gray-900'
                    }`}
                  >
                    {activeDeck.isPublic ? 'Public' : 'Private'}
                  </button>
                </div>

                <div className="space-y-3 text-sm mb-6">
                  <div className="p-3 bg-gray-900/50 rounded-xl border border-gray-800">
                    <span className="text-gray-400 block text-xs">Mane Character</span>
                    <span className="font-bold text-pink-400 truncate block">
                      {activeDeck.mane ? activeDeck.mane.name : 'Not Selected'}
                    </span>
                  </div>
                  <div className="p-3 bg-gray-900/50 rounded-xl border border-gray-800">
                    <span className="text-gray-400 block text-xs">Story Arcs (Required 4)</span>
                    <span className="font-bold text-purple-300">
                      {activeDeck.stories.length === 4 ? 'Complete (4/4)' : `${activeDeck.stories.length}/4`}
                    </span>
                  </div>
                  <div className="p-3 bg-gray-900/50 rounded-xl border border-gray-800">
                    <span className="text-gray-400 block text-xs">Scene Cards</span>
                    <span
                      className={`font-bold ${
                        activeDeck.scenes.length === 15 ? 'text-green-400' : 'text-yellow-400'
                      }`}
                    >
                      {activeDeck.scenes.length} / 15
                    </span>
                  </div>
                  <div className="p-3 bg-gray-900/50 rounded-xl border border-gray-800">
                    <span className="text-gray-400 block text-xs">Main Deck Cards</span>
                    <span className="font-bold text-white">{activeDeck.main.length} cards</span>
                  </div>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div className="flex flex-col space-y-2 mb-6">
                <button
                  onClick={() => setActiveTab('mane')}
                  className={`p-3 rounded-xl text-left font-semibold text-sm transition ${
                    activeTab === 'mane'
                      ? 'bg-pink-600 text-white shadow-lg'
                      : 'bg-gray-900 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  1. Mane Character
                </button>
                <button
                  onClick={() => setActiveTab('stories')}
                  className={`p-3 rounded-xl text-left font-semibold text-sm transition ${
                    activeTab === 'stories'
                      ? 'bg-pink-600 text-white shadow-lg'
                      : 'bg-gray-900 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  2. Story Arcs
                </button>
                <button
                  onClick={() => setActiveTab('scenes')}
                  className={`p-3 rounded-xl text-left font-semibold text-sm transition ${
                    activeTab === 'scenes'
                      ? 'bg-pink-600 text-white shadow-lg'
                      : 'bg-gray-900 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  3. Scene Cards ({activeDeck.scenes.length}/15)
                </button>
                <button
                  onClick={() => setActiveTab('main')}
                  className={`p-3 rounded-xl text-left font-semibold text-sm transition ${
                    activeTab === 'main'
                      ? 'bg-pink-600 text-white shadow-lg'
                      : 'bg-gray-900 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  4. Attribute Card Pool
                </button>
              </div>

              {/* Save & Export Actions */}
              <div className="space-y-2">
                <button
                  onClick={handleSaveDeck}
                  className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 font-bold rounded-xl shadow-lg transition text-center"
                >
                  Save Deck
                </button>
                <button
                  onClick={handleExportDeck}
                  className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 font-semibold rounded-xl text-sm transition text-center"
                >
                  Export JSON
                </button>
              </div>
            </div>

            {/* Main Selector Grid */}
            <div className="flex-1 bg-gray-800/60 border border-gray-700 rounded-2xl p-6 shadow-xl">
              {activeTab === 'mane' && (
                <div>
                  <h3 className="text-2xl font-bold mb-2 text-white">Choose Your Mane Character</h3>
                  <p className="text-sm text-gray-400 mb-6">
                    Select the foundational Mane Character that dictates your deck's attributes and legal card pool.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {maneCharacters.map((card) => (
                      <div
                        key={card.id}
                        onClick={() => setActiveDeck({ ...activeDeck, mane: card })}
                        className={`border-2 rounded-2xl p-3 cursor-pointer bg-gray-900/80 transition hover:border-pink-500 ${
                          activeDeck.mane?.id === card.id
                            ? 'border-pink-500 shadow-lg shadow-pink-500/20 bg-gray-900'
                            : 'border-gray-800'
                        }`}
                      >
                        <img
                          src={card.image_url || '/assets/default-card-back.webp'}
                          alt={card.name}
                          className="w-full h-56 object-cover rounded-xl mb-3"
                          onError={(e) => {
                            e.currentTarget.src = '/assets/default-card-back.webp';
                          }}
                        />
                        <h4 className="font-bold text-sm truncate text-white">{card.name}</h4>
                        <p className="text-xs text-gray-400 mt-1 truncate">Traits: {card.traits}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'stories' && (
                <div>
                  <h3 className="text-2xl font-bold mb-2 text-white">Select a Story Arc (Set of 4)</h3>
                  <p className="text-sm text-gray-400 mb-6">
                    Choose one complete story arc containing 4 sequential cards.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {Object.entries(groupedStoryArcs).map(([arcName, arcCards]) => {
                      const isSelected = activeDeck.stories.some((s) =>
                        arcCards.some((ac) => ac.id === s.id)
                      );
                      return (
                        <div
                          key={arcName}
                          onClick={() =>
                            setActiveDeck({
                              ...activeDeck,
                              stories: isSelected ? [] : arcCards.slice(0, 4),
                            })
                          }
                          className={`border-2 rounded-2xl p-5 cursor-pointer bg-gray-900/80 transition hover:border-pink-500 ${
                            isSelected
                              ? 'border-pink-500 shadow-lg shadow-pink-500/20 bg-gray-900'
                              : 'border-gray-800'
                          }`}
                        >
                          <div className="flex justify-between items-center mb-3">
                            <h4 className="font-bold text-lg text-pink-300">{arcName} Arc</h4>
                            <span
                              className={`text-xs px-3 py-1 rounded-full font-bold ${
                                isSelected ? 'bg-pink-600 text-white' : 'bg-gray-800 text-gray-400'
                              }`}
                            >
                              {isSelected ? 'Selected (4/4)' : 'Click to Select'}
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {arcCards.map((card) => (
                              <img
                                key={card.id}
                                src={card.image_url || '/assets/default-card-back.webp'}
                                alt={card.name}
                                className="w-full h-28 object-cover rounded-lg"
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
                  <h3 className="text-2xl font-bold mb-2 text-white">
                    Select Scene Cards ({activeDeck.scenes.length} / 15 Required)
                  </h3>
                  <p className="text-sm text-gray-400 mb-6">
                    Pick exactly 15 Scene or Event cards for your deck's scene stack.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {sceneCards.map((card) => {
                      const isSelected = activeDeck.scenes.some((s) => s.id === card.id);
                      return (
                        <div
                          key={card.id}
                          onClick={() => {
                            if (isSelected) {
                              setActiveDeck({
                                ...activeDeck,
                                scenes: activeDeck.scenes.filter((s) => s.id !== card.id),
                              });
                            } else {
                              if (activeDeck.scenes.length < 15) {
                                setActiveDeck({
                                  ...activeDeck,
                                  scenes: [...activeDeck.scenes, card],
                                });
                              }
                            }
                          }}
                          className={`border-2 rounded-2xl p-3 cursor-pointer bg-gray-900/80 transition relative hover:border-pink-500 ${
                            isSelected
                              ? 'border-pink-500 shadow-lg shadow-pink-500/20 bg-gray-900'
                              : 'border-gray-800'
                          }`}
                        >
                          {isSelected && (
                            <span className="absolute top-4 right-4 bg-pink-600 text-xs px-2.5 py-1 rounded-full font-bold shadow">
                              Added
                            </span>
                          )}
                          <img
                            src={card.image_url || '/assets/default-card-back.webp'}
                            alt={card.name}
                            className="w-full h-48 object-cover rounded-xl mb-2"
                            onError={(e) => {
                              e.currentTarget.src = '/assets/default-card-back.webp';
                            }}
                          />
                          <h4 className="font-bold text-xs truncate text-white">{card.name}</h4>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === 'main' && (
                <div>
                  <h3 className="text-2xl font-bold mb-2 text-white">Attribute-Filtered Card Pool</h3>
                  <p className="text-sm text-gray-400 mb-6">
                    Showing legal cards matching Mane Character attributes:{' '}
                    <span className="text-pink-400 font-semibold">
                      {activeDeck.mane ? activeDeck.mane.traits : 'None Selected (Showing All)'}
                    </span>
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {getLegalMainDeckCards().map((card) => (
                      <div
                        key={card.id}
                        onClick={() =>
                          setActiveDeck({
                            ...activeDeck,
                            main: [...activeDeck.main, card],
                          })
                        }
                        className="border-2 border-gray-800 hover:border-pink-500 rounded-2xl p-3 cursor-pointer bg-gray-900/80 transition flex flex-col justify-between"
                      >
                        <div>
                          <img
                            src={card.image_url || '/assets/default-card-back.webp'}
                            alt={card.name}
                            className="w-full h-48 object-cover rounded-xl mb-2"
                            onError={(e) => {
                              e.currentTarget.src = '/assets/default-card-back.webp';
                            }}
                          />
                          <h4 className="font-bold text-xs truncate text-white">{card.name}</h4>
                        </div>
                        <div className="mt-3 pt-2 border-t border-gray-800 flex justify-between text-xs text-gray-400">
                          <span>Cost: {card.cost}</span>
                          <button className="text-pink-400 font-bold hover:underline">+ Add</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Import / Export Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 max-w-lg w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-2 text-white">Import / Export Deck JSON</h3>
            <p className="text-xs text-gray-400 mb-4">
              Copy your deck JSON or paste a shared deck configuration below.
            </p>
            <textarea
              value={importExportText}
              onChange={(e) => setImportExportText(e.target.value)}
              rows={8}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl p-3 text-xs text-green-300 font-mono focus:outline-none focus:border-pink-500 mb-4"
              placeholder="Paste deck JSON here..."
            />
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleImportDeck}
                className="px-5 py-2 bg-pink-600 hover:bg-pink-500 rounded-xl text-sm font-bold shadow-lg transition"
              >
                Import Deck
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}