vimport React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import './StableHub.css';

export interface DeckSummary {
  id: string;
  name: string;
  author: string;
  element: string;
  mane_character: string | null;
  mane_image_url: string;
  is_starter: boolean;
  is_public: boolean;
  card_count: number;
  has_wishlist_cards: boolean;
  owner_id?: string;
}

interface StableHubProps {
  currentUserId: string;
  onOpenBuilder: (deckId: string | null, mode: 'CREATE' | 'EDIT' | 'VIEW' | 'COPY') => void;
}

function isCardUnowned(card: any, ownedIds: Set<string>): boolean {
  if (!card) return false;
  const id = String(card.id || '');
  const setCode = String(card.set_code || '');
  if (/^SD/i.test(id) || /^SD/i.test(setCode)) return false;

  const rarity = String(card.rarity || 'C').toUpperCase();
  if (['C', 'U', 'R'].includes(rarity) && !id.includes('-S')) return false;

  const isEverydayScene =
    card.card_type === 'Scene' &&
    (!card.element ||
      String(card.element).toLowerCase() === 'everyday' ||
      /everyday/i.test(card.name || '') ||
      /-EV/i.test(id));
  if (isEverydayScene && !id.includes('-S')) return false;

  return !ownedIds.has(id);
}

export default function StableHub({ currentUserId, onOpenBuilder }: StableHubProps) {
  const [activeTab, setActiveTab] = useState<'MY_DECKS' | 'STARTERS' | 'COMMUNITY'>('MY_DECKS');
  const [allDecks, setAllDecks] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const [customBgUrl, setCustomBgUrl] = useState<string>('');
  const [bgOpacity, setBgOpacity] = useState<number>(1);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/media/settings`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && data.settings) {
          if (data.settings.bg_stable) setCustomBgUrl(data.settings.bg_stable);
          if (data.settings.bg_stable_opacity !== undefined) {
            setBgOpacity(parseFloat(data.settings.bg_stable_opacity));
          }
        }
      })
      .catch((err) => console.error('Error loading global stable theme:', err));
  }, []);

  const fetchDecks = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const [decksRes, cardsRes, colRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/decks`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }),
        fetch(`${API_BASE_URL}/api/cards`),
        token
          ? fetch(`${API_BASE_URL}/api/auth/me/collection`, {
              headers: { Authorization: `Bearer ${token}` },
            })
          : Promise.resolve(null),
      ]);

      const rawDecks = decksRes.ok ? await decksRes.json() : [];
      const cards = cardsRes.ok ? await cardsRes.json() : [];
      const colData = colRes && colRes.ok ? await colRes.json() : [];

      const ownedIds = new Set<string>(
        Array.isArray(colData) ? colData.map((row: any) => String(row.card_id)) : []
      );

      const cardList = Array.isArray(cards) ? cards : [];
      const cardMap = new Map<string, any>(
        cardList.map((c: any) => [String(c.id).toLowerCase(), c])
      );

      const mapped: DeckSummary[] = (Array.isArray(rawDecks) ? rawDecks : []).map((d: any) => {
        const maneId = d.mane_character ? String(d.mane_character).toLowerCase() : '';
        let maneCard = maneId ? cardMap.get(maneId) : null;

        if (!maneCard && d.name) {
          const ponyName = String(d.name).split('-')[0].trim().toLowerCase();
          maneCard = cardList.find(
            (c: any) =>
              c.card_type === 'Mane Character' &&
              c.name &&
              c.name.toLowerCase().includes(ponyName)
          );
        }

        const storyIds: string[] = Array.isArray(d.story_deck) ? d.story_deck : [];
        const sceneIds: string[] = Array.isArray(d.scene_deck) ? d.scene_deck : [];
        const mainIds: string[] = Array.isArray(d.main_deck) ? d.main_deck : [];
        const totalCount =
          (d.mane_character || maneCard ? 1 : 0) +
          storyIds.length +
          sceneIds.length +
          mainIds.length;

        const isStarter = Boolean(d.is_starter || String(d.id).startsWith('starter-'));
        const allIdsInDeck = [
          ...(maneCard ? [maneCard.id] : []),
          ...storyIds,
          ...sceneIds,
          ...mainIds,
        ];
        const hasWishlist =
          !isStarter &&
          allIdsInDeck.some((cid) => {
            const cObj = cardMap.get(String(cid).toLowerCase());
            return cObj ? isCardUnowned(cObj, ownedIds) : false;
          });

        return {
          id: d.id,
          name: d.name || 'Untitled Deck',
          author: d.author || 'Player',
          element: d.element || maneCard?.element || 'Unaligned',
          mane_character: d.mane_character || maneCard?.id || null,
          mane_image_url:
            d.mane_image_url ||
            maneCard?.image_url ||
            'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/SD01-C01.webp',
          is_starter: isStarter,
          is_public: d.is_public ?? true,
          card_count: totalCount,
          has_wishlist_cards: hasWishlist,
          owner_id: d.user_id || d.owner_id || currentUserId,
        };
      });

      setAllDecks(mapped);
    } catch (err) {
      console.error('Failed to load decks in StableHub:', err);
      setAllDecks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDecks();
  }, [currentUserId]);

  const handleDeleteDeck = async (deckId: string, deckName: string) => {
    if (!window.confirm(`Are you sure you want to delete "${deckName}"?`)) return;

    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`${API_BASE_URL}/api/decks/${deckId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Delete failed');
      setAllDecks((prev) => prev.filter((d) => d.id !== deckId));
    } catch (err) {
      console.error('Error deleting deck:', err);
      alert('Failed to delete deck.');
    }
  };

  const filteredDecks = allDecks.filter((deck) => {
    if (activeTab === 'STARTERS') {
      return deck.is_starter;
    }
    if (activeTab === 'COMMUNITY') {
      return deck.is_public && !deck.is_starter;
    }
    const isMine =
      deck.is_starter ||
      !deck.owner_id ||
      deck.owner_id === currentUserId;
    return isMine;
  });

  return (
    <div
      className="stable-hub-container"
      style={customBgUrl ? { backgroundImage: `url(${customBgUrl})` } : undefined}
    >
      {customBgUrl && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: '#150624',
            opacity: 1 - bgOpacity,
            zIndex: 1,
            pointerEvents: 'none',
          }}
        />
      )}

      <div className="stable-content-wrapper">
        <div className="stable-header">
          <div>
            <h1>🐎 The Stable</h1>
            <span className="stable-subtitle">Craft, customize, and manage your Equestrian TCG decks</span>
          </div>
          <button className="build-new-btn" onClick={() => onOpenBuilder(null, 'CREATE')}>
            ✨ Build New Deck ✦
          </button>
        </div>

        <div className="stable-tabs">
          <button
            className={`stable-tab-btn ${activeTab === 'MY_DECKS' ? 'active' : ''}`}
            onClick={() => setActiveTab('MY_DECKS')}
          >
            My Decks
          </button>
          <button
            className={`stable-tab-btn ${activeTab === 'STARTERS' ? 'active' : ''}`}
            onClick={() => setActiveTab('STARTERS')}
          >
            Starter Decks (6)
          </button>
          <button
            className={`stable-tab-btn ${activeTab === 'COMMUNITY' ? 'active' : ''}`}
            onClick={() => setActiveTab('COMMUNITY')}
          >
            Community Decks
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '50px', color: '#ffd700', fontSize: '18px' }}>
            <strong>Loading the Stable... ✨</strong>
          </div>
        ) : (
          <div className="deck-grid">
            {filteredDecks.map((deck) => {
              const isEditable = !deck.is_starter && (!deck.owner_id || deck.owner_id === currentUserId);

              return (
                <div key={deck.id} className="deck-card">
                  <div
                    className="deck-card-banner"
                    style={{ backgroundImage: `url(${deck.mane_image_url})` }}
                  >
                    <div className="deck-card-element">{deck.element}</div>
                  </div>

                  <div className="deck-card-info">
                    <h3 className="deck-card-title">{deck.name}</h3>
                    <div className="deck-card-author">by {deck.author}</div>

                    <div className="deck-card-stats">
                      <span>{deck.card_count} / 70 Cards</span>
                      {deck.is_starter && <span style={{ color: '#ffd700' }}>★ Official Starter</span>}
                      {deck.has_wishlist_cards && (
                        <span style={{ color: '#fda4af' }} title="Unlock missing cards from packs before queuing">
                          🔒 Wishlist Cards
                        </span>
                      )}
                    </div>

                    <div className="deck-card-actions">
                      {isEditable ? (
                        <>
                          <button
                            className="deck-action-btn btn-primary"
                            onClick={() => onOpenBuilder(deck.id, 'EDIT')}
                          >
                            Edit
                          </button>
                          <button
                            className="deck-action-btn btn-copy"
                            onClick={() => onOpenBuilder(deck.id, 'COPY')}
                          >
                            Copy
                          </button>
                          <button
                            className="deck-action-btn btn-danger"
                            onClick={() => handleDeleteDeck(deck.id, deck.name)}
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="deck-action-btn btn-secondary"
                            onClick={() => onOpenBuilder(deck.id, 'VIEW')}
                          >
                            View List
                          </button>
                          <button
                            className="deck-action-btn btn-copy"
                            onClick={() => onOpenBuilder(deck.id, 'COPY')}
                          >
                            Copy to Mine
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {!loading && filteredDecks.length === 0 && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  color: '#fbcfe8',
                  padding: '40px',
                  background: 'rgba(36, 12, 56, 0.55)',
                  borderRadius: '28px',
                  border: '2px dashed rgba(255, 158, 187, 0.45)',
                }}
              >
                No decks found in this category yet. Click <strong>Build New Deck</strong> to create one!
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}