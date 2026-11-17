import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import CardPreviewModal, { PreviewableCard } from './CardPreviewModal';
import './ShopView.css';

interface CardItem extends PreviewableCard {
  id: string;
  name: string;
  card_type: string;
  element: string;
  rarity: string;
  cost: number;
  power: number;
  effect_text?: string;
  image_url?: string;
}

interface WeeklyDeal {
  id: number;
  price: number;
  slot_index: number;
  card_id: string;
  name: string;
  card_type: string;
  element: string;
  rarity: string;
  cost: number;
  power: number;
  effect_text?: string;
  image_url?: string;
}

const CARD_BACK_URL = 'https://pub-7c3c4a1adbf240ddbb5c65941361f846.r2.dev/cards/CardBack.webp';

export default function ShopView() {
  const [points, setPoints] = useState<number>(0);
  const [deals, setDeals] = useState<WeeklyDeal[]>([]);
  const [tiers, setTiers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Interactive Pack Rip & 3D Flip States
  const [activePackTier, setActivePackTier] = useState<{ key: string; name: string } | null>(null);
  const [packStage, setPackStage] = useState<'SEALED' | 'RIPPING' | 'REVEALING'>('SEALED');
  const [pulledCards, setPulledCards] = useState<CardItem[] | null>(null);
  const [flippedIndices, setFlippedIndices] = useState<Record<number, boolean>>({});
  const [previewCard, setPreviewCard] = useState<PreviewableCard | null>(null);

  const fetchShopData = async () => {
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.get(`${API_BASE_URL}/api/shop/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setPoints(data.reward_points);
      setDeals(data.weeklyDeals);
      setTiers(data.tiers || {});
    } catch (err) {
      console.error('Failed to load shop', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShopData();
  }, []);

  const handleBuyPack = async (tierKey: string, cost: number, tierName: string) => {
    if (points < cost) {
      setMessage('Not enough Pony Points! Play more matches to earn points.');
      return;
    }
    setPurchasing(true);
    setMessage(null);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_BASE_URL}/api/shop/buy-pack`,
        { tier: tierKey },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      setPoints(data.remainingPoints);
      setPulledCards(data.cards);
      setActivePackTier({ key: tierKey, name: tierName });
      setPackStage('SEALED');
      setFlippedIndices({});
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Failed to open pack.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleRipPack = () => {
    if (packStage !== 'SEALED') return;
    setPackStage('RIPPING');
    setTimeout(() => {
      setPackStage('REVEALING');
    }, 680);
  };

  const handleCardSlotClick = (card: CardItem, idx: number) => {
    if (!flippedIndices[idx]) {
      setFlippedIndices((prev) => ({ ...prev, [idx]: true }));
    } else {
      setPreviewCard(card);
    }
  };

  const revealAllCards = () => {
    if (!pulledCards) return;
    const all: Record<number, boolean> = {};
    pulledCards.forEach((_, idx) => {
      all[idx] = true;
    });
    setFlippedIndices(all);
  };

  const closePackModal = () => {
    setPulledCards(null);
    setActivePackTier(null);
    setPackStage('SEALED');
    setFlippedIndices({});
    setPreviewCard(null);
  };

  const handleBuyDeal = async (dealId: number, price: number) => {
    if (points < price) {
      setMessage('Not enough Pony Points for this weekly deal.');
      return;
    }
    setPurchasing(true);
    setMessage(null);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_BASE_URL}/api/shop/buy-deal`,
        { dealId },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      setPoints(data.remainingPoints);
      setMessage(`Successfully unlocked guaranteed card: ${data.card.name}!`);
      fetchShopData();
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Failed to buy deal.');
    } finally {
      setPurchasing(false);
    }
  };

  if (loading) return <div className="shop-loading">Loading Pony Shop... ✨</div>;

  const allRevealed =
    pulledCards !== null &&
    pulledCards.length > 0 &&
    pulledCards.every((_, idx) => Boolean(flippedIndices[idx]));

  return (
    <div className="shop-container">
      {/* Full-resolution Card Preview Inspector */}
      <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} />

      <div className="shop-header">
        <h2>✨ The Pony Point Shop ✨</h2>
        <div className="shop-points-badge">
          🪙 Pony Points: <strong>{points}</strong>
        </div>
      </div>

      {message && <div className="shop-message-banner">{message}</div>}

      {/* PACK TIERS SECTION */}
      <div className="shop-section">
        <h3>🎁 Foil Booster Packs (Guaranteed SR+)</h3>
        <p className="shop-section-desc">
          All Commons, Uncommons, and Rares are already unlocked in your Stable! Packs contain exclusively{' '}
          <strong>SR, SSR, UR, GR, and CR</strong> cards.
        </p>

        <div className="pack-tiers-grid">
          {Object.entries(tiers).map(([key, tier]) => (
            <div key={key} className={`pack-tier-card tier-${key.toLowerCase()}`}>
              <span className="pack-tier-ribbon">{tier.badge || 'FOIL PACK'}</span>
              <span className="pack-price-tag">{tier.cost} 🪙</span>
              <h4>{tier.name}</h4>
              <p>{tier.description}</p>
              {tier.rates && (
                <div className="pack-odds-pills">
                  {Object.entries(tier.rates).map(([rar, prob]) => (
                    <span key={rar} className="odds-pill">
                      {rar}: {Math.round(Number(prob) * 100)}%
                    </span>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="shop-buy-btn"
                disabled={purchasing}
                onClick={() => handleBuyPack(key, tier.cost, tier.name)}
              >
                {purchasing ? 'Summoning Pack...' : `Buy Pack (${tier.cost} 🪙)`}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* WEEKLY FEATURED DEALS SECTION */}
      <div className="shop-section">
        <h3>🌟 Weekly Featured Deals</h3>
        <p className="shop-section-desc">Guaranteed high-rarity cards (click card art to preview). Refreshed weekly!</p>

        <div className="weekly-deals-grid">
          {deals.map((deal) => (
            <div key={deal.id} className="deal-card">
              <span className="deal-rarity-badge">{deal.rarity}</span>
              <img
                src={deal.image_url || CARD_BACK_URL}
                alt={deal.name}
                className="deal-card-img"
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  setPreviewCard({
                    id: deal.card_id,
                    name: deal.name,
                    card_type: deal.card_type,
                    element: deal.element,
                    rarity: deal.rarity,
                    cost: deal.cost,
                    power: deal.power,
                    effect_text: deal.effect_text,
                    image_url: deal.image_url,
                  })
                }
              />
              <h4>{deal.name}</h4>
              <div className="deal-card-meta">
                {deal.card_type} • {deal.element}
              </div>
              <button
                type="button"
                className="shop-buy-btn deal-btn"
                disabled={purchasing}
                onClick={() => handleBuyDeal(deal.id, deal.price)}
              >
                Buy for {deal.price} 🪙
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* INTERACTIVE PACK RIP & 3D CARD FLIP MODAL */}
      {pulledCards && (
        <div
          className="pack-reveal-backdrop"
          onClick={() => {
            if (packStage === 'REVEALING' && allRevealed && !previewCard) closePackModal();
          }}
        >
          <div className="pack-reveal-modal" onClick={(e) => e.stopPropagation()}>
            {packStage !== 'REVEALING' ? (
              <div className="sealed-pack-stage">
                <h3>✨ {activePackTier?.name || 'Booster Pack'} Ready! ✨</h3>
                <p>Click the booster pack or tear along the foil strip to rip it open!</p>

                <div
                  className={`booster-foil-wrapper ${
                    packStage === 'RIPPING' ? 'ripping-active' : 'sealed-idle'
                  } tier-${(activePackTier?.key || 'bronze').toLowerCase()}`}
                  onClick={handleRipPack}
                >
                  <div className="booster-foil-top-flap">
                    <span className="foil-crimp-lines" />
                    <span className="foil-tear-hint">✂️ TEAR HERE</span>
                  </div>
                  <div className="booster-tear-laser" />
                  <div className="booster-foil-body">
                    <div className="booster-emblem">EQUESTRIA CLASH</div>
                    <div className="booster-sub-emblem">{activePackTier?.name}</div>
                    <div className="booster-sparkle-ring">✦ ✧ ✦</div>
                  </div>
                </div>

                <button
                  type="button"
                  className="shop-buy-btn rip-trigger-btn"
                  onClick={handleRipPack}
                  disabled={packStage === 'RIPPING'}
                >
                  {packStage === 'RIPPING' ? '✨ Ripping Foil...' : '✂️ Rip Open Pack!'}
                </button>
              </div>
            ) : (
              <>
                <h3>🎉 Tap to Flip — Click Revealed Cards to Preview!</h3>
                <p>Click a face-down card to flip it, or click an open card to inspect its rules text.</p>

                <div className="pulled-cards-row">
                  {pulledCards.map((card, idx) => {
                    const isFlipped = Boolean(flippedIndices[idx]);
                    const isUltra = ['UR', 'GR', 'CR', 'SPR'].includes(card.rarity);
                    return (
                      <div
                        key={idx}
                        className={`flip-card-scene ${isFlipped ? 'is-flipped' : ''} ${
                          isUltra ? 'ultra-foil' : ''
                        }`}
                        style={{ animationDelay: `${idx * 0.08}s` }}
                        onClick={() => handleCardSlotClick(card, idx)}
                      >
                        <div className="flip-card-inner">
                          {/* Back of Card */}
                          <div className="flip-card-face flip-card-back">
                            <img src={CARD_BACK_URL} alt="Card Back" />
                            <span className="tap-to-flip-pill">Tap to Flip ✨</span>
                          </div>

                          {/* Front of Card */}
                          <div className="flip-card-face flip-card-front">
                            <span className={`pulled-rarity rarity-${card.rarity.toLowerCase()}`}>
                              {card.rarity}
                            </span>
                            <img src={card.image_url || CARD_BACK_URL} alt={card.name} />
                            <h5>{card.name}</h5>
                            <span>🔍 Click to Preview</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pack-modal-actions">
                  {!allRevealed && (
                    <button
                      type="button"
                      className="shop-buy-btn deal-btn"
                      style={{ width: 'auto', padding: '10px 22px' }}
                      onClick={revealAllCards}
                    >
                      ✨ Reveal All Cards
                    </button>
                  )}
                  <button
                    type="button"
                    className="shop-buy-btn"
                    style={{ padding: '10px 26px' }}
                    onClick={closePackModal}
                  >
                    {allRevealed ? 'Awesome, Collect! ✨' : 'Collect & Close'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}