import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE_URL } from '../config';
import CardPreviewModal, { PreviewableCard } from './CardPreviewModal';
import './CollectionBinder.css';

interface BinderCard extends PreviewableCard {
  id: string;
  name: string;
  set_code: string;
  card_type: string;
  cost: number;
  power: number;
  effect_text: string;
  element: string | null;
  rarity: string;
  image_url: string;
}

interface CollectionBinderProps {
  onBackToStable?: () => void;
}

const CARDS_PER_PAGE = 16; // 4 x 4 binder layout

export default function CollectionBinder({ onBackToStable }: CollectionBinderProps) {
  const [cards, setCards] = useState<BinderCard[]>([]);
  const [ownedQuantities, setOwnedQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Filters & Pagination
  const [selectedSet, setSelectedSet] = useState<string>('ALL');
  const [selectedRarity, setSelectedRarity] = useState<string>('ALL');
  const [ownershipFilter, setOwnershipFilter] = useState<'ALL' | 'COLLECTED' | 'MISSING'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [previewCard, setPreviewCard] = useState<BinderCard | null>(null);

  useEffect(() => {
    const loadBinderData = async () => {
      try {
        const token = localStorage.getItem('token');
        const cardsRes = await fetch(`${API_BASE_URL}/api/cards`);
        const allCards = await cardsRes.json();
        const catalog: BinderCard[] = Array.isArray(allCards) ? allCards : [];
        setCards(catalog);

        if (token) {
          let colRes = await fetch(`${API_BASE_URL}/api/auth/me/collection`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!colRes.ok) {
            colRes = await fetch(`${API_BASE_URL}/api/users/me/collection`, {
              headers: { Authorization: `Bearer ${token}` },
            });
          }
          if (colRes.ok) {
            const colData = await colRes.json();
            const qtyMap: Record<string, number> = {};
            if (Array.isArray(colData)) {
              for (const row of colData) {
                qtyMap[row.card_id] = Number(row.quantity) || 1;
              }
            }
            setOwnedQuantities(qtyMap);
          }
        }
      } catch (err) {
        console.error('Failed to load collection binder:', err);
      } finally {
        setLoading(false);
      }
    };

    loadBinderData();
  }, []);

  // Determine how many copies of a card the user owns (including default C/U/R/SD01/Everyday unlocks)
  const getOwnedCount = (card: BinderCard): number => {
    if (ownedQuantities[card.id] && ownedQuantities[card.id] > 0) {
      return ownedQuantities[card.id];
    }
    const isAlt = card.id.includes('-S');
    if (isAlt) return 0;

    if (/^SD/i.test(card.id) || /^SD/i.test(card.set_code || '')) return 3;
    const rarity = String(card.rarity || 'C').toUpperCase();
    if (['C', 'U', 'R'].includes(rarity)) return 3;

    const isEverydayScene =
      card.card_type === 'Scene' &&
      (!card.element ||
        card.element.toLowerCase() === 'everyday' ||
        /everyday/i.test(card.name || '') ||
        /-EV/i.test(card.id));
    if (isEverydayScene) return 3;

    return 0;
  };

  // Available sets sorted cleanly
  const availableSets = useMemo(() => {
    const setCodes = new Set<string>();
    cards.forEach((c) => {
      if (c.set_code) setCodes.add(c.set_code.toUpperCase());
    });
    return Array.from(setCodes).sort((a, b) => a.localeCompare(b));
  }, [cards]);

  // Sorted & filtered card pool
  const filteredCards = useMemo(() => {
    return cards
      .filter((card) => {
        const setMatch =
          selectedSet === 'ALL' || (card.set_code || '').toUpperCase() === selectedSet;
        const rarityMatch =
          selectedRarity === 'ALL' || (card.rarity || '').toUpperCase() === selectedRarity;
        const searchMatch =
          !searchQuery.trim() ||
          card.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          card.id.toLowerCase().includes(searchQuery.toLowerCase());

        const count = getOwnedCount(card);
        const ownerMatch =
          ownershipFilter === 'ALL' ||
          (ownershipFilter === 'COLLECTED' && count > 0) ||
          (ownershipFilter === 'MISSING' && count === 0);

        return setMatch && rarityMatch && searchMatch && ownerMatch;
      })
      .sort((a, b) => {
        const setCmp = (a.set_code || '').localeCompare(b.set_code || '');
        if (setCmp !== 0) return setCmp;
        return a.id.localeCompare(b.id, undefined, { numeric: true });
      });
  }, [cards, ownedQuantities, selectedSet, selectedRarity, ownershipFilter, searchQuery]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedSet, selectedRarity, ownershipFilter, searchQuery]);

  // Collection completion stats (scoped to currently selected set)
  const setStats = useMemo(() => {
    const pool =
      selectedSet === 'ALL'
        ? cards
        : cards.filter((c) => (c.set_code || '').toUpperCase() === selectedSet);
    const total = pool.length;
    const collected = pool.filter((c) => getOwnedCount(c) > 0).length;
    const pct = total > 0 ? Math.round((collected / total) * 100) : 0;
    return { total, collected, pct };
  }, [cards, ownedQuantities, selectedSet]);

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / CARDS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * CARDS_PER_PAGE;
  const pageCards = filteredCards.slice(pageStart, pageStart + CARDS_PER_PAGE);

  // Pad trailing page to 16 binder pockets so the 4x4 binder sheet always stays full
  const binderSlots: (BinderCard | null)[] = [...pageCards];
  while (binderSlots.length < CARDS_PER_PAGE) {
    binderSlots.push(null);
  }

  if (loading) {
    return <div className="binder-loading">Opening Your Equestria Card Binder... 📖✨</div>;
  }

  return (
    <div className="binder-page-container">
      <CardPreviewModal
        card={previewCard}
        ownedCount={previewCard ? getOwnedCount(previewCard) : 0}
        onClose={() => setPreviewCard(null)}
      />

      {/* Top Header & Progress Bar */}
      <div className="binder-header">
        <div className="binder-title-group">
          {onBackToStable && (
            <button type="button" className="binder-back-btn" onClick={onBackToStable}>
              🔙 Back to Stable
            </button>
          )}
          <div>
            <h2>📖 Equestria Collection Binder</h2>
            <span className="binder-subtitle">
              {selectedSet === 'ALL' ? 'Complete Master Card Pool' : `Set: ${selectedSet}`} •{' '}
              <strong>
                {setStats.collected} / {setStats.total}
              </strong>{' '}
              Collected ({setStats.pct}%)
            </span>
          </div>
        </div>

        <div className="binder-progress-wrapper">
          <div className="binder-progress-track">
            <div className="binder-progress-fill" style={{ width: `${setStats.pct}%` }} />
          </div>
          <span className="binder-progress-label">{setStats.pct}% Complete</span>
        </div>
      </div>

      {/* Controls & Set Tabs */}
      <div className="binder-controls-bar">
        <div className="binder-set-pills">
          <button
            type="button"
            className={`set-pill ${selectedSet === 'ALL' ? 'active' : ''}`}
            onClick={() => setSelectedSet('ALL')}
          >
            All Sets
          </button>
          {availableSets.map((setCode) => (
            <button
              key={setCode}
              type="button"
              className={`set-pill ${selectedSet === setCode ? 'active' : ''}`}
              onClick={() => setSelectedSet(setCode)}
            >
              {setCode}
            </button>
          ))}
        </div>

        <div className="binder-filter-inputs">
          <input
            type="text"
            className="binder-input"
            placeholder="Search name or card ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <select
            className="binder-select"
            value={selectedRarity}
            onChange={(e) => setSelectedRarity(e.target.value)}
          >
            <option value="ALL">All Rarities</option>
            <option value="C">Common (C)</option>
            <option value="U">Uncommon (U)</option>
            <option value="R">Rare (R)</option>
            <option value="SR">Super Rare (SR)</option>
            <option value="SSR">Super Secret Rare (SSR)</option>
            <option value="UR">Ultra Rare (UR)</option>
            <option value="GR">Gold Rare (GR)</option>
            <option value="CR">Crystal Rare (CR)</option>
            <option value="SPR">Special Parallel (SPR)</option>
          </select>
          <select
            className="binder-select"
            value={ownershipFilter}
            onChange={(e) => setOwnershipFilter(e.target.value as any)}
          >
            <option value="ALL">Show All Slots</option>
            <option value="COLLECTED">Collected Only ✨</option>
            <option value="MISSING">Uncollected Only 🔒</option>
          </select>
        </div>
      </div>

      {/* 4 x 4 Virtual Binder Page */}
      <div className="virtual-binder-wrapper">
        <div className="binder-spine-rings" aria-hidden="true">
          <span className="binder-ring" />
          <span className="binder-ring" />
          <span className="binder-ring" />
        </div>

        <div className="binder-sheet-4x4">
          {binderSlots.map((card, idx) => {
            if (!card) {
              return (
                <div key={`empty-${idx}`} className="binder-pocket empty-pocket">
                  <span className="empty-pocket-label">Empty Slot</span>
                </div>
              );
            }

            const owned = getOwnedCount(card);
            const isCollected = owned > 0;
            const isStory =
              card.card_type === 'Story' ||
              /-(?:C2[5-9]|C[3-4]\d)/i.test(card.id || '') ||
              (card.name || '').includes(' - ') ||
              (card.name || '').includes(' – ');

            return (
              <div
                key={card.id}
                className={`binder-pocket ${isCollected ? 'collected' : 'uncollected'}`}
                onClick={() => setPreviewCard(card)}
                title={`${card.id} — ${card.name} (${isCollected ? `Owned ×${owned}` : 'Not Collected'})`}
              >
                <div className="binder-pocket-header">
                  <span className="pocket-id">{card.id}</span>
                  <span className={`pocket-rarity rarity-${card.rarity.toLowerCase()}`}>
                    {card.rarity}
                  </span>
                </div>

                <div className={`binder-card-sleeve ${isStory ? 'story-sleeve' : ''}`}>
                  <img src={card.image_url} alt={card.name} loading="lazy" />
                  {!isCollected && (
                    <div className="uncollected-overlay">
                      <span className="uncollected-lock">🔒</span>
                      <span className="uncollected-text">Not Collected</span>
                    </div>
                  )}
                  {isCollected && <span className="owned-count-badge">×{owned}</span>}
                </div>

                <div className="binder-pocket-footer">
                  <span className="pocket-name">{card.name}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Page Navigation Bar */}
      <div className="binder-pagination-bar">
        <button
          type="button"
          className="binder-page-btn"
          disabled={safePage <= 1}
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
        >
          ‹ Previous Page
        </button>

        <div className="binder-page-indicator">
          Binder Page <strong>{safePage}</strong> of <strong>{totalPages}</strong>
          <span className="binder-page-sub">
            ({filteredCards.length} cards matching filters)
          </span>
        </div>

        <button
          type="button"
          className="binder-page-btn"
          disabled={safePage >= totalPages}
          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
        >
          Next Page ›
        </button>
      </div>
    </div>
  );
}