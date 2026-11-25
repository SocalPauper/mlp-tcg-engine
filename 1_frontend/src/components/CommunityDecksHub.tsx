import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import { getCardFoilClass } from '../utils/cardFoil';
import './CommunityDecksHub.css';

interface PublicDeck {
  id: string;
  name: string;
  author: string;
  element: string;
  is_public: boolean;
  is_starter: boolean;
  mane_character: string | null;
  mane_rarity?: string | null;
  mane_image_url: string | null;
  deck_banner_url: string | null;
  banner_crop_position?: string;
  banner_zoom?: number;
  story_deck: any[];
  scene_deck: any[];
  main_deck: any[];
  created_at?: string;
}

interface CommunityDecksHubProps {
  onCopyDeckToStable: (deckId: string) => void;
  onViewDeckInBuilder: (deckId: string) => void;
}

const CARD_BACK_URL = 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/CardBack.webp';

export default function CommunityDecksHub({
  onCopyDeckToStable,
  onViewDeckInBuilder,
}: CommunityDecksHubProps) {
  const [decks, setDecks] = useState<PublicDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [elementFilter, setElementFilter] = useState('ALL');

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/decks`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const publicUserDecks = data.filter(
            (d: PublicDeck) => !d.is_starter && Boolean(d.is_public)
          );
          setDecks(publicUserDecks);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load community decks:', err);
        setLoading(false);
      });
  }, []);

  const filteredDecks = decks.filter((d) => {
    const matchesSearch =
      String(d.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(d.author || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesElement =
      elementFilter === 'ALL' ||
      String(d.element || '').toLowerCase() === elementFilter.toLowerCase();
    return matchesSearch && matchesElement;
  });

  return (
    <div className="community-decks-viewport">
      <div className="community-decks-container">
        <div className="community-decks-header">
          <div>
            <h2>🌍 Community Public Decks ✨</h2>
            <span className="community-decks-subtitle">
              Browse decks shared by fellow duelists, inspect their lists, or copy one into your Stable!
            </span>
          </div>

          <div className="community-decks-filters">
            <input
              type="text"
              className="community-filter-input"
              placeholder="Search deck name or creator..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className="community-filter-select"
              value={elementFilter}
              onChange={(e) => setElementFilter(e.target.value)}
            >
              <option value="ALL">All Elements</option>
              <option value="Magic">Magic</option>
              <option value="Loyalty">Loyalty</option>
              <option value="Honesty">Honesty</option>
              <option value="Generosity">Generosity</option>
              <option value="Kindness">Kindness</option>
              <option value="Laughter">Laughter</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#ffd700', fontWeight: 900 }}>
            Gathering public decklists from Equestria... ✨
          </div>
        ) : filteredDecks.length === 0 ? (
          <div className="community-empty-box">
            <div style={{ fontSize: '40px', marginBottom: '10px' }}>📚✨</div>
            <h3 style={{ margin: '0 0 6px', color: '#ffd700' }}>No Public Decks Match Your Filter</h3>
            <p style={{ margin: 0, fontSize: '14px' }}>
              Build a deck in <strong>The Stable</strong> and toggle <strong>Public Deck 🌍</strong> to be the first to share your list!
            </p>
          </div>
        ) : (
          <div className="community-decks-grid">
            {filteredDecks.map((deck) => {
              const totalCount =
                (deck.mane_character ? 1 : 0) +
                (deck.story_deck?.length || 0) +
                (deck.scene_deck?.length || 0) +
                (deck.main_deck?.length || 0);
              const foilCls = getCardFoilClass({
                id: deck.mane_character,
                rarity: deck.mane_rarity,
              });

              return (
                <div key={deck.id} className="community-deck-card">
                  <div
                    className={`community-deck-banner ${foilCls}`}
                    style={{
                      backgroundImage: `url(${
                        deck.deck_banner_url || deck.mane_image_url || CARD_BACK_URL
                      })`,
                      backgroundSize: deck.banner_zoom ? `${deck.banner_zoom}%` : 'cover',
                      backgroundPosition: deck.banner_crop_position || '50% 25%',
                    }}
                  >
                    <span className="community-deck-element-pill">
                      {deck.element || 'Unaligned'}
                    </span>
                  </div>

                  <div className="community-deck-body">
                    <div>
                      <h3>{deck.name}</h3>
                      <div className="community-deck-meta">
                        Created by <strong>{deck.author || 'Duelist'}</strong> • {totalCount}/70 Cards
                      </div>
                    </div>

                    <div className="community-deck-actions">
                      <button
                        type="button"
                        className="community-btn-inspect"
                        onClick={() => onViewDeckInBuilder(deck.id)}
                      >
                        👁️ Inspect List
                      </button>
                      <button
                        type="button"
                        className="community-btn-copy"
                        onClick={() => onCopyDeckToStable(deck.id)}
                      >
                        📋 Copy to Stable
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}