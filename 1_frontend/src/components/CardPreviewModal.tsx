import React, { useEffect, useState } from 'react';
import { API_BASE_URL } from '../config';
import { getCardFoilClass } from '../styles/cardFoil';

export interface PreviewableCard {
  id: string;
  name: string;
  card_type?: string;
  type?: string;
  element?: string | null;
  rarity?: string;
  cost?: number;
  power?: number;
  traits?: string;
  effect_text?: string;
  effectText?: string;
  image_url?: string;
  imageUrl?: string;
}

interface CardPreviewModalProps {
  card: PreviewableCard | null;
  ownedCount?: number;
  hideOwnership?: boolean;
  onClose: () => void;
}

let cachedCollectionMap: Record<string, number> | null = null;

export function invalidatePreviewCollectionCache() {
  cachedCollectionMap = null;
}

export default function CardPreviewModal({
  card,
  ownedCount,
  hideOwnership = false,
  onClose,
}: CardPreviewModalProps) {
  const [fetchedQty, setFetchedQty] = useState<number | null>(null);

  useEffect(() => {
    if (!card || hideOwnership || ownedCount !== undefined) {
      setFetchedQty(null);
      return;
    }

    const computeQty = (map: Record<string, number>) => {
      if (map[card.id] !== undefined) return map[card.id];
      const id = String(card.id || '').toUpperCase();
      const rarity = String(card.rarity || 'C').toUpperCase();
      const cType = String(card.card_type || card.type || '').toLowerCase();
      const maxPlayset = cType.includes('mane') || cType.includes('main') ? 1 : 4;
      if (id.endsWith('-S')) return 0;
      if (/^SD/i.test(id) || ['C', 'U', 'R', 'SPR'].includes(rarity)) return maxPlayset;
      return 0;
    };

    if (cachedCollectionMap) {
      setFetchedQty(computeQty(cachedCollectionMap));
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      setFetchedQty(computeQty({}));
      return;
    }

    fetch(`${API_BASE_URL}/api/auth/me/collection`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        const map: Record<string, number> = {};
        if (Array.isArray(rows)) {
          for (const r of rows) {
            map[r.card_id] = Number(r.quantity) || 0;
          }
        }
        cachedCollectionMap = map;
        setFetchedQty(computeQty(map));
      })
      .catch(() => setFetchedQty(computeQty({})));
  }, [card, ownedCount, hideOwnership]);

  if (!card) return null;

  const imgSrc = card.image_url || card.imageUrl || '';
  const rulesText = card.effect_text || card.effectText || 'No special effect text.';
  const cardType = card.card_type || card.type || 'Card';
  const maxCopies =
    cardType.toLowerCase().includes('mane') || cardType.toLowerCase().includes('main') ? 1 : 4;
  const resolvedOwned = ownedCount !== undefined ? ownedCount : fetchedQty;
  const foilCls = getCardFoilClass(card);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(12, 4, 24, 0.85)',
        backdropFilter: 'blur(6px)',
        zIndex: 10050,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'radial-gradient(circle at top, #3b0764 0%, #1a0b2e 100%)',
          border: '3px solid #ffd700',
          borderRadius: '24px',
          padding: '24px',
          maxWidth: '640px',
          width: '100%',
          color: '#fff',
          display: 'flex',
          gap: '22px',
          flexWrap: 'wrap',
          alignItems: 'center',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)',
          fontFamily: "'Nunito', sans-serif",
        }}
      >
        <div
          className={foilCls}
          style={{
            width: '210px',
            borderRadius: '14px',
            overflow: 'hidden',
            border: '2px solid #ffd700',
            flexShrink: 0,
            margin: '0 auto',
          }}
        >
          <img
            src={imgSrc}
            alt={card.name}
            style={{ width: '100%', display: 'block', objectFit: 'cover' }}
          />
        </div>

        <div
          style={{
            flex: 1,
            minWidth: '240px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#e9d5ff' }}>
              {card.id}
            </span>

            {!hideOwnership && resolvedOwned !== null && (
              <span
                style={{
                  background:
                    resolvedOwned >= maxCopies
                      ? 'rgba(16, 185, 129, 0.25)'
                      : resolvedOwned > 0
                      ? 'rgba(253, 224, 71, 0.2)'
                      : 'rgba(148, 163, 184, 0.2)',
                  border: `1.5px solid ${
                    resolvedOwned >= maxCopies
                      ? '#34d399'
                      : resolvedOwned > 0
                      ? '#fde047'
                      : '#94a3b8'
                  }`,
                  color:
                    resolvedOwned >= maxCopies
                      ? '#6ee7b7'
                      : resolvedOwned > 0
                      ? '#fde047'
                      : '#cbd5e1',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '12px',
                  fontWeight: 900,
                }}
              >
                📖 Copies Owned: {resolvedOwned} / {maxCopies}
              </span>
            )}
          </div>

          <h3 style={{ margin: 0, color: '#ffd700', fontSize: '1.4rem' }}>{card.name}</h3>

          <div style={{ fontSize: '13px', color: '#fbcfe8', fontWeight: 800 }}>
            {cardType} • {card.element || 'Everyday'} • Rarity: {card.rarity || 'C'}
            {card.cost !== undefined ? ` • Cost: ${card.cost}` : ''}
            {card.power ? ` • Inspiration: ${card.power}` : ''}
          </div>

          <div
            style={{
              background: 'rgba(15, 5, 28, 0.78)',
              border: '1.5px solid rgba(192, 132, 252, 0.5)',
              borderRadius: '14px',
              padding: '12px 14px',
              fontSize: '13.5px',
              lineHeight: 1.5,
              color: '#f3e8ff',
              whiteSpace: 'pre-wrap',
            }}
          >
            {rulesText}
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              marginTop: '6px',
              alignSelf: 'flex-end',
              background: 'linear-gradient(135deg, #ec4899, #9333ea)',
              color: '#fff',
              border: '2px solid #ffd700',
              borderRadius: '999px',
              padding: '8px 22px',
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
}