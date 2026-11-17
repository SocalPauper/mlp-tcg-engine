import React from 'react';
import './CardPreviewModal.css';

export interface PreviewableCard {
  id: string;
  name: string;
  set_code?: string;
  card_type: string;
  cost?: number;
  power?: number;
  defense?: number;
  traits?: string;
  effect_text?: string;
  element?: string | null;
  rarity: string;
  image_url?: string;
}

interface CardPreviewModalProps {
  card: PreviewableCard | null;
  onClose: () => void;
  ownedCount?: number;
}

const CARD_BACK_URL = 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/CardBack.webp';

export default function CardPreviewModal({ card, onClose, ownedCount }: CardPreviewModalProps) {
  if (!card) return null;

  const isStory =
    card.card_type === 'Story' ||
    /-(?:C2[5-9]|C[3-4]\d)/i.test(card.id || '') ||
    (card.name || '').includes(' - ') ||
    (card.name || '').includes(' – ');

  const rarityUpper = String(card.rarity || 'C').toUpperCase();
  const isUltra = ['UR', 'GR', 'CR', 'SPR'].includes(rarityUpper);

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div
        className={`preview-modal ${isStory ? 'story-landscape-modal' : ''} ${
          isUltra ? 'ultra-rare-glow' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="preview-close-btn" onClick={onClose} aria-label="Close preview">
          ✕
        </button>

        <div className={`preview-image-container ${isStory ? 'story-landscape-box' : ''}`}>
          <img src={card.image_url || CARD_BACK_URL} alt={card.name} />
        </div>

        <div className="preview-data-panel">
          <div className="preview-header">
            <h2>{card.name}</h2>
            {['Character', 'Friend Character', 'Event', 'Item'].includes(card.card_type) &&
              card.cost !== undefined && <div className="preview-cost-badge">{card.cost}</div>}
          </div>

          <div className="preview-meta-grid">
            <div>
              <span className="preview-meta-label">TYPE</span>
              <span className="preview-meta-value">{card.card_type}</span>
            </div>
            <div>
              <span className="preview-meta-label">RARITY</span>
              <span className={`preview-rarity-pill ${isUltra ? 'ultra' : ''}`}>
                {rarityUpper}
              </span>
            </div>
          </div>

          {card.element && (
            <div style={{ marginBottom: '16px' }}>
              <span className="preview-meta-label">ELEMENT</span>
              <span className="preview-element-pill">{card.element}</span>
            </div>
          )}

          <div className="preview-rules-box">
            <span className="preview-meta-label">RULES TEXT</span>
            <p>
              {card.effect_text ||
                (card.id.includes('ER')
                  ? 'Inspo Boost: Your matching characters get +1 Inspiration until the end of this contact.'
                  : 'No abilities.')}
            </p>
          </div>

          {['Character', 'Friend Character'].includes(card.card_type) && card.power !== undefined && (
            <div className="preview-power-row">
              <span className="preview-meta-label">POWER</span>
              <span className="preview-power-value">⚔️ {card.power}</span>
            </div>
          )}

          <div className="preview-footer">
            <span className="preview-card-id">{card.id}</span>
            {typeof ownedCount === 'number' && (
              <span className={`preview-owned-badge ${ownedCount > 0 ? 'owned' : 'missing'}`}>
                {ownedCount > 0 ? `Owned: ×${ownedCount}` : 'Not Yet Collected'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}