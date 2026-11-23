import React from 'react';
import { getCardFoilClass } from '../styles/cardFoil';
import './CardPreviewModal.css';

export interface PreviewableCard {
  id: string;
  name: string;
  set_code?: string;
  setCode?: string;
  card_type?: string;
  type?: string;
  cost?: number;
  power?: number;
  defense?: number;
  traits?: string;
  effect_text?: string;
  effectText?: string;
  element?: string | null;
  rarity?: string;
  image_url?: string;
  imageUrl?: string;
}

interface CardPreviewModalProps {
  card: PreviewableCard | null;
  onClose: () => void;
  ownedCount?: number;
}

const CARD_BACK_URL = 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/CardBack.webp';

function sanitizeText(raw?: string): string {
  if (!raw) return '';
  return raw
    .replace(/\{\{[^}]*$/g, '')
    .replace(/\{\{|\}\}/g, '')
    .replace(/\bonly\s+only\b/gi, 'Only')
    .trim();
}

function parseCleanTraits(raw?: string): string[] {
  const cleaned = sanitizeText(raw);
  if (!cleaned) return [];
  // Ignore raw numeric placeholders or leaked effect sentences in traits column
  if (/^\d+$/.test(cleaned) || cleaned.length > 48 || /when promoted|draw \d/i.test(cleaned)) {
    return [];
  }
  return cleaned
    .split(/[,/|•·]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !/^\d+$/.test(t));
}

function splitEffectClauses(rawText: string): string[] {
  if (!rawText) return [];
  // Insert line breaks before major Kayou trigger keywords so compound cards are easy to read
  const normalized = rawText.replace(
    /\s+(?=(?:Appear|Farewell|Adventure|Pre-Plan|Inspo Boost|Inspiration Boost|Treat for you!|Treat for me!|Deliver Present|Unwrap Present)\b)/gi,
    '\n'
  );
  return normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderFormattedClause(clause: string, keyPrefix: string) {
  const tokenRegex =
    /((?:Appear|Farewell|Adventure|Pre-Plan|Inspo Boost|Inspiration Boost|Treat for you!|Treat for me!|Deliver Present|Unwrap Present|Only adorn|Only use when|Tap)\s*:?|[｢\[「][^｣\]」]+[｣\]」])/gi;

  const parts = clause.split(tokenRegex);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (/^[｢\[「][^｣\]」]+[｣\]」]$/.test(part)) {
      return (
        <span key={`${keyPrefix}-${idx}`} className="preview-bracket-chip">
          {part}
        </span>
      );
    }
    if (
      /^(?:Appear|Farewell|Adventure|Pre-Plan|Inspo Boost|Inspiration Boost|Treat for you!|Treat for me!|Deliver Present|Unwrap Present|Only adorn|Only use when|Tap)\s*:?$/i.test(
        part
      )
    ) {
      return (
        <span key={`${keyPrefix}-${idx}`} className="preview-keyword-chip">
          {part.trim()}
        </span>
      );
    }
    return <React.Fragment key={`${keyPrefix}-${idx}`}>{part}</React.Fragment>;
  });
}

export default function CardPreviewModal({ card, onClose, ownedCount }: CardPreviewModalProps) {
  if (!card) return null;

  const cardType = card.card_type || card.type || 'Card';
  const imageUrl = card.image_url || card.imageUrl || CARD_BACK_URL;
  const setCode = card.set_code || card.setCode || card.id.split('-')[0] || '';
  const rawEffect = sanitizeText(card.effect_text ?? card.effectText);
  const displayEffect =
    rawEffect ||
    (card.id.toUpperCase().includes('ER')
      ? 'Inspo Boost: Your matching characters get +1 Inspiration until the end of this Contact.'
      : '');

  const isStory =
    cardType === 'Story' ||
    /-(?:C2[5-9]|C[3-4]\d)/i.test(card.id || '') ||
    (card.name || '').includes(' - ') ||
    (card.name || '').includes(' – ');

  const isCharacter = cardType.toLowerCase().includes('character') && !cardType.toLowerCase().includes('mane');
  const hasCost = ['Character', 'Friend Character', 'Event', 'Item'].includes(cardType) && card.cost !== undefined;
  const rarityUpper = String(card.rarity || 'C').toUpperCase();
  const isShining = card.id.toUpperCase().endsWith('-S');
  const isUltra = ['UR', 'GR', 'CR', 'DR', 'SPR'].includes(rarityUpper) || isShining;
  const foilCls = getCardFoilClass(card);
  const traitsList = parseCleanTraits(card.traits);
  const effectClauses = splitEffectClauses(displayEffect);

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div
        className={`preview-modal ${isStory ? 'story-landscape-modal' : ''} ${
          isUltra ? 'ultra-rare-glow' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="preview-close-btn"
          onClick={onClose}
          aria-label="Close preview"
        >
          ✕
        </button>

        <div
          className={`preview-image-container ${
            isStory ? 'story-landscape-box' : ''
          } ${foilCls}`}
        >
          <img src={imageUrl} alt={card.name} />
        </div>

        <div className="preview-data-panel">
          <div className="preview-header">
            <div>
              <h2>{card.name}</h2>
              <div className="preview-subtitle-row">
                <span className="preview-card-id">{card.id}</span>
                {setCode && <span className="preview-set-chip">{setCode}</span>}
              </div>
            </div>

            <div className="preview-stat-badges">
              {hasCost && (
                <div className="preview-cost-badge" title="Force of Harmony Cost">
                  <span className="stat-mini-label">COST</span>
                  <strong>{card.cost}</strong>
                </div>
              )}
              {isCharacter && card.power !== undefined && (
                <div className="preview-inspo-badge" title="Base Inspiration">
                  <span className="stat-mini-label">INSPO</span>
                  <strong>⚡ {card.power}</strong>
                </div>
              )}
            </div>
          </div>

          <div className="preview-meta-grid">
            <div>
              <span className="preview-meta-label">CARD TYPE</span>
              <span className="preview-meta-value">{cardType}</span>
            </div>
            <div>
              <span className="preview-meta-label">RARITY</span>
              <span className={`preview-rarity-pill ${isUltra ? 'ultra' : ''}`}>
                {isShining ? `${rarityUpper}-S (Shining Foil)` : rarityUpper}
              </span>
            </div>
            {card.element && (
              <div>
                <span className="preview-meta-label">ELEMENT</span>
                <span className="preview-element-pill">{card.element}</span>
              </div>
            )}
            {traitsList.length > 0 && (
              <div>
                <span className="preview-meta-label">TRAITS</span>
                <div className="preview-traits-row">
                  {traitsList.map((trait, idx) => (
                    <span key={idx} className="preview-trait-pill">
                      {trait}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="preview-rules-box">
            <span className="preview-meta-label">ABILITIES &amp; EFFECTS</span>
            {effectClauses.length > 0 ? (
              <div className="preview-clauses-list">
                {effectClauses.map((clause, idx) => (
                  <p key={idx} className="preview-clause-line">
                    {renderFormattedClause(clause, `cl-${idx}`)}
                  </p>
                ))}
              </div>
            ) : (
              <p className="preview-empty-rules">No printed abilities.</p>
            )}
          </div>

          <div className="preview-footer">
            <span className="preview-hint-text">Click outside or ✕ to close</span>
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