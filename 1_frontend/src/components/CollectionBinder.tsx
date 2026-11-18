import React, { useState, useEffect, useMemo, useCallback } from 'react';
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

const CARDS_PER_LEAF = 9;    // 3x3 pockets per binder sheet
const CARDS_PER_SPREAD = 18; // Left page (9) + Right page (9)

export default function CollectionBinder({ onBackToStable }: CollectionBinderProps) {
  const [cards, setCards] = useState<BinderCard[]>([]);
  const [ownedQuantities, setOwnedQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Binder Open / Flip State
  const [isBinderOpen, setIsBinderOpen] = useState<boolean>(false);
  const [flipDirection, setFlipDirection] = useState<'none' | 'next' | 'prev'>('none');

  // Global wallpaper, opacity, cover art & title loaded from auth.site_settings
  const [customBgUrl, setCustomBgUrl] = useState<string>('');
  const [bgOpacity, setBgOpacity] = useState<number>(1);
  const [coverArtUrl, setCoverArtUrl] = useState<string>('');
  const [coverTitle, setCoverTitle] = useState<string>('Equestria Royal Archive');

  // Filters & Spread Pagination
  const [selectedSet, setSelectedSet] = useState<string>('ALL');
  const [selectedRarity, setSelectedRarity] = useState<string>('ALL');
  const [ownershipFilter, setOwnershipFilter] = useState<'ALL' | 'COLLECTED' | 'MISSING'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentSpread, setCurrentSpread] = useState<number>(1);
  const [previewCard, setPreviewCard] = useState<BinderCard | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/media/settings`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && data.settings) {
          if (data.settings.bg_collection) setCustomBgUrl(data.settings.bg_collection);
          if (data.settings.bg_collection_opacity !== undefined) {
            setBgOpacity(parseFloat(data.settings.bg_collection_opacity));
          }
          if (data.settings.bg_binder_cover) {
            setCoverArtUrl(data.settings.bg_binder_cover);
          }
          if (data.settings.binder_cover_title) {
            setCoverTitle(data.settings.binder_cover_title);
          }
        }
      })
      .catch((err) => console.error('Error loading global collection theme:', err));
  }, []);

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

  const availableSets = useMemo(() => {
    const setCodes = new Set<string>();
    cards.forEach((c) => {
      if (c.set_code) setCodes.add(c.set_code.toUpperCase());
    });
    return Array.from(setCodes).sort((a, b) => a.localeCompare(b));
  }, [cards]);

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

  useEffect(() => {
    setCurrentSpread(1);
  }, [selectedSet, selectedRarity, ownershipFilter, searchQuery]);

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

  const totalSpreads = Math.max(1, Math.ceil(filteredCards.length / CARDS_PER_SPREAD));
  const safeSpread = Math.min(currentSpread, totalSpreads);

  const triggerPageTurn = useCallback(
    (direction: 'next' | 'prev') => {
      if (direction === 'next' && safeSpread >= totalSpreads) return;
      if (direction === 'prev' && safeSpread <= 1) return;

      setFlipDirection(direction);
      setTimeout(() => {
        setCurrentSpread((prev) =>
          direction === 'next' ? Math.min(totalSpreads, prev + 1) : Math.max(1, prev - 1)
        );
        setFlipDirection('none');
      }, 210);
    },
    [safeSpread, totalSpreads]
  );

  // Keyboard Arrow Navigation when Binder is Open
  useEffect(() => {
    if (!isBinderOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (previewCard) return;
      if (e.key === 'ArrowRight') triggerPageTurn('next');
      if (e.key === 'ArrowLeft') triggerPageTurn('prev');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBinderOpen, previewCard, triggerPageTurn]);

  const spreadStart = (safeSpread - 1) * CARDS_PER_SPREAD;
  const spreadCards = filteredCards.slice(spreadStart, spreadStart + CARDS_PER_SPREAD);

  const leftLeafSlots: (BinderCard | null)[] = spreadCards.slice(0, CARDS_PER_LEAF);
  while (leftLeafSlots.length < CARDS_PER_LEAF) leftLeafSlots.push(null);

  const rightLeafSlots: (BinderCard | null)[] = spreadCards.slice(CARDS_PER_LEAF, CARDS_PER_SPREAD);
  while (rightLeafSlots.length < CARDS_PER_LEAF) rightLeafSlots.push(null);

  const leftPageNumber = (safeSpread - 1) * 2 + 1;
  const rightPageNumber = leftPageNumber + 1;

  const renderPocket = (card: BinderCard | null, key: string) => {
    if (!card) {
      return (
        <div key={key} className="binder-pocket empty-pocket">
          <span className="empty-pocket-label">Empty Pocket</span>
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
              <span className="uncollected-text">Locked</span>
            </div>
          )}
          {isCollected && <span className="owned-count-badge">×{owned}</span>}
        </div>

        <div className="binder-pocket-footer">
          <span className="pocket-name">{card.name}</span>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="binder-viewport">
        <div className="binder-loading">Fetching Your Equestria Collector's Binder... 📖✨</div>
      </div>
    );
  }

  return (
    <div
      className="binder-viewport"
      style={customBgUrl ? { backgroundImage: `url(${customBgUrl})` } : undefined}
    >
      {/* Background Opacity Tint Layer Controlled by Admin Settings */}
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
              <h2>📖 {coverTitle}</h2>
              <span className="binder-subtitle">
                {selectedSet === 'ALL' ? 'Complete Master Card Pool' : `Set: ${selectedSet}`} •{' '}
                <strong>
                  {setStats.collected} / {setStats.total}
                </strong>{' '}
                Collected ({setStats.pct}%)
              </span>
            </div>
          </div>

          <div className="binder-header-right">
            <button
              type="button"
              className="binder-cover-toggle-btn"
              onClick={() => setIsBinderOpen((prev) => !prev)}
            >
              {isBinderOpen ? '📕 Close Cover' : '📖 Flip Open Binder'}
            </button>

            <div className="binder-progress-wrapper">
              <div className="binder-progress-track">
                <div className="binder-progress-fill" style={{ width: `${setStats.pct}%` }} />
              </div>
              <span className="binder-progress-label">{setStats.pct}% Complete</span>
            </div>
          </div>
        </div>

        {/* CLOSED 3-RING BINDER COVER VIEW */}
        {!isBinderOpen ? (
          <div className="binder-closed-stage">
            <div
              className="binder-closed-cover"
              style={coverArtUrl ? { backgroundImage: `url(${coverArtUrl})` } : undefined}
              onClick={() => setIsBinderOpen(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setIsBinderOpen(true)}
            >
              {coverArtUrl && <div className="binder-cover-art-vignette" aria-hidden="true" />}

              <div className="binder-cover-content">
                <div className="binder-cover-emblem">{coverArtUrl ? '✨' : '🦄✨📖'}</div>

                <div className="binder-cover-title-plate">
                  <h1 className="binder-cover-title">{coverTitle}</h1>
                  <p className="binder-cover-desc">
                    Official 3-Ring Collector's Album • 9-Pocket Ultra-Clear Protective Sleeves
                  </p>
                </div>

                <div className="binder-cover-stats-pill">
                  Master Progress: {setStats.collected} / {setStats.total} Cards ({setStats.pct}%)
                </div>

                <div className="binder-open-cta">✨ Click to Flip Open Binder ✨</div>
              </div>
            </div>
          </div>
        ) : (
          <>
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

            {/* OPEN TWO-PAGE 3-RING BINDER SPREAD */}
            <div className="open-binder-case">
              <div className="open-binder-spread">
                {/* LEFT 9-POCKET SLEEVE SHEET */}
                <div
                  className={`binder-leaf left-leaf ${
                    flipDirection === 'prev' ? 'flip-prev-out' : ''
                  }`}
                >
                  <div className="leaf-page-header">
                    <span>Page {leftPageNumber}</span>
                    <span>9-Pocket Sleeve</span>
                  </div>
                  <div className="binder-sheet-3x3">
                    {leftLeafSlots.map((card, idx) =>
                      renderPocket(card, `left-${safeSpread}-${idx}`)
                    )}
                  </div>
                </div>

                {/* CENTER 3-RING STEEL SPINE */}
                <div className="binder-center-spine" aria-hidden="true">
                  <div className="metal-d-ring">
                    <span className="ring-arch" />
                  </div>
                  <div className="metal-d-ring">
                    <span className="ring-arch" />
                  </div>
                  <div className="metal-d-ring">
                    <span className="ring-arch" />
                  </div>
                </div>

                {/* RIGHT 9-POCKET SLEEVE SHEET */}
                <div
                  className={`binder-leaf right-leaf ${
                    flipDirection === 'next' ? 'flip-next-out' : ''
                  }`}
                >
                  <div className="leaf-page-header">
                    <span>9-Pocket Sleeve</span>
                    <span>Page {rightPageNumber}</span>
                  </div>
                  <div className="binder-sheet-3x3">
                    {rightLeafSlots.map((card, idx) =>
                      renderPocket(card, `right-${safeSpread}-${idx}`)
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Page-Turn Navigation Bar */}
            <div className="binder-pagination-bar">
              <button
                type="button"
                className="binder-page-btn"
                disabled={safeSpread <= 1}
                onClick={() => triggerPageTurn('prev')}
              >
                ‹ Flip Left (Pages {Math.max(1, leftPageNumber - 2)}–{Math.max(2, rightPageNumber - 2)})
              </button>

              <div className="binder-page-indicator">
                Pages <strong>{leftPageNumber}–{rightPageNumber}</strong> (Spread {safeSpread} of {totalSpreads})
                <span className="binder-page-sub">
                  {filteredCards.length} cards matching filters • Tip: Use ← / → arrow keys to flip pages
                </span>
              </div>

              <button
                type="button"
                className="binder-page-btn"
                disabled={safeSpread >= totalSpreads}
                onClick={() => triggerPageTurn('next')}
              >
                Flip Right (Pages {leftPageNumber + 2}–{rightPageNumber + 2}) ›
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}