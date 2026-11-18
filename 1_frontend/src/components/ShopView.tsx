import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { useAuth } from '../App';
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
  const { user, updateUserPoints } = useAuth();
  const [points, setPoints] = useState<number>(user?.reward_points ?? 0);
  const [weekId, setWeekId] = useState<string>('');
  const [deals, setDeals] = useState<WeeklyDeal[]>([]);
  const [tiers, setTiers] = useState<Record<string, any>>({});
  const [tradeInSummary, setTradeInSummary] = useState<{
    extraCardsCount: number;
    totalPointsValue: number;
  }>({ extraCardsCount: 0, totalPointsValue: 0 });
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [customBgUrl, setCustomBgUrl] = useState<string>('');
  const [bgOpacity, setBgOpacity] = useState<number>(1);

  const [activePackTier, setActivePackTier] = useState<{ key: string; name: string } | null>(null);
  const [packStage, setPackStage] = useState<'SEALED' | 'RIPPING' | 'REVEALING'>('SEALED');
  const [pulledCards, setPulledCards] = useState<CardItem[] | null>(null);
  const [flippedIndices, setFlippedIndices] = useState<Record<number, boolean>>({});
  const [previewCard, setPreviewCard] = useState<PreviewableCard | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/media/settings`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success && data.settings) {
          if (data.settings.bg_shop) setCustomBgUrl(data.settings.bg_shop);
          if (data.settings.bg_shop_opacity !== undefined) {
            setBgOpacity(parseFloat(data.settings.bg_shop_opacity));
          }
        }
      })
      .catch((err) => console.error('Error loading global shop theme:', err));
  }, []);

  const syncPoints = (newVal: number) => {
    setPoints(newVal);
    updateUserPoints(newVal);
  };

  const fetchShopData = async () => {
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.get(`${API_BASE_URL}/api/shop/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      syncPoints(data.reward_points);
      setWeekId(data.weekId || '');
      setDeals(data.weeklyDeals || []);
      setTiers(data.tiers || {});
      if (data.tradeInSummary) {
        setTradeInSummary(data.tradeInSummary);
      }
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
      setMessage('Not enough Pony Points! Play more matches or trade in extra copies to earn points.');
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
      syncPoints(data.remainingPoints);
      if (data.tradeInSummary) setTradeInSummary(data.tradeInSummary);
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
      syncPoints(data.remainingPoints);
      if (data.tradeInSummary) setTradeInSummary(data.tradeInSummary);
      setMessage(`✨ Successfully unlocked featured card: ${data.card.name}!`);
      fetchShopData();
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Failed to buy deal.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleTradeInExtras = async () => {
    if (tradeInSummary.extraCardsCount <= 0) return;
    if (
      !window.confirm(
        `Trade in ${tradeInSummary.extraCardsCount} extra card(s) beyond your 3-card playsets for +${tradeInSummary.totalPointsValue} Pony Points?`
      )
    ) {
      return;
    }

    setPurchasing(true);
    setMessage(null);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_BASE_URL}/api/shop/trade-in-extras`,
        {},
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      syncPoints(data.remainingPoints);
      setTradeInSummary(data.tradeInSummary || { extraCardsCount: 0, totalPointsValue: 0 });
      setMessage(
        `♻️ Traded in ${data.tradedCount} extra copy/copies for +${data.pointsEarned} Pony Points!`
      );
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Failed to trade in extra cards.');
    } finally {
      setPurchasing(false);
    }
  };

  if (loading) {
    return (
      <div className="shop-viewport">
        <div className="shop-loading">Opening the Canterlot Pony Point Shop... ✨</div>
      </div>
    );
  }

  const allRevealed =
    pulledCards !== null &&
    pulledCards.length > 0 &&
    pulledCards.every((_, idx) => Boolean(flippedIndices[idx]));

  const formatRate = (prob: number) => {
    const pct = prob * 100;
    return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
  };

  return (
    <div
      className="shop-viewport"
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

      <div className="shop-container">
        <CardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} />

        <div className="shop-header">
          <div>
            <h2>✨ The Pony Point Shop ✨</h2>
            <span className="shop-subtitle">
              Redeem match rewards for guaranteed weekly singles &amp; shiny foil booster packs
            </span>
          </div>

          <div className="shop-header-actions">
            <button
              type="button"
              className="trade-in-btn"
              disabled={purchasing || tradeInSummary.extraCardsCount <= 0}
              onClick={handleTradeInExtras}
              title="Convert any cards with more than 3 copies in your collection into Pony Points"
            >
              {tradeInSummary.extraCardsCount > 0
                ? `♻️ Trade-In ${tradeInSummary.extraCardsCount} Extra(s) (+${tradeInSummary.totalPointsValue} 🪙)`
                : '♻️ No Extras (>3 Copies)'}
            </button>

            <div className="shop-points-badge">
              🪙 Pony Points: <strong>{points}</strong>
            </div>
          </div>
        </div>

        {message && <div className="shop-message-banner">{message}</div>}

        {/* ROW 1: CARDS OF THE WEEK ON MINIATURE EASELS WITH SPOTLIGHTS */}
        <div className="shop-section">
          <div className="shop-section-header">
            <h3>🌟 Cards of the Week</h3>
            {weekId && <span className="week-tag">Auto-Rotating • {weekId}</span>}
          </div>
          <p className="shop-section-desc">
            Spotlighted single cards available for direct unlock. Click any card on its easel to inspect its rules!
          </p>

          <div className="weekly-easels-grid">
            {deals.map((deal) => (
              <div key={deal.id} className="easel-stage">
                <div className="easel-spotlight-beam" aria-hidden="true" />
                <span className="easel-rarity-pill">{deal.rarity}</span>

                <div className="mini-easel-assembly">
                  <div className="easel-top-finial" />
                  <div
                    className="easel-card-canvas"
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
                  >
                    <img src={deal.image_url || CARD_BACK_URL} alt={deal.name} />
                  </div>
                  <div className="easel-ledge" />
                  <div className="easel-legs" aria-hidden="true">
                    <span className="easel-leg left" />
                    <span className="easel-leg right" />
                  </div>
                </div>

                <div className="easel-info-plaque">
                  <h4>{deal.name}</h4>
                  <div className="easel-card-meta">
                    {deal.card_type} • {deal.element || 'Unaligned'}
                  </div>
                  <button
                    type="button"
                    className="shop-buy-btn deal-btn"
                    disabled={purchasing}
                    onClick={() => handleBuyDeal(deal.id, deal.price)}
                  >
                    Unlock Card ({deal.price} 🪙)
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ROW 2: 3 SHINY FOIL BOOSTER PACK OBJECTS + DISTRIBUTION BOXES */}
        <div className="shop-section">
          <div className="shop-section-header">
            <h3>🎁 Shiny Foil Booster Packs (SR &amp; Above Only)</h3>
          </div>
          <p className="shop-section-desc">
            All Commons, Uncommons, and Rares are already unlocked in your Stable. Every pack guarantees{' '}
            <strong>SR, SSR, UR, GR, CR, or SPR</strong> pulls!
          </p>

          <div className="packs-showcase-grid">
            {Object.entries(tiers).map(([key, tier]) => (
              <div key={key} className="pack-showcase-column">
                <div
                  className={`shiny-foil-pack tier-${key.toLowerCase()}`}
                  onClick={() => !purchasing && handleBuyPack(key, tier.cost, tier.name)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && !purchasing && handleBuyPack(key, tier.cost, tier.name)
                  }
                >
                  <div className="foil-pack-crimp" />
                  <div className="foil-pack-center">
                    <div className="foil-pack-logo">EQUESTRIA CLASH</div>
                    <div className="foil-pack-tier-title">{tier.name}</div>
                    <div className="foil-pack-count-badge">{tier.badge}</div>
                    <div className="foil-pack-cost-pill">{tier.cost} 🪙</div>
                  </div>
                  <div className="foil-pack-crimp bottom" />
                </div>

                <div className="pack-distribution-box">
                  <div className="pack-dist-header">
                    <h4>{tier.name}</h4>
                    <span className="pack-dist-cost">{tier.cost} 🪙</span>
                  </div>
                  <p className="pack-dist-desc">{tier.description}</p>

                  {tier.rates && (
                    <div className="pack-odds-pills">
                      {Object.entries(tier.rates).map(([rar, prob]) => (
                        <span key={rar} className="odds-pill">
                          {rar}: {formatRate(Number(prob))}
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
                    {purchasing ? 'Summoning Pack...' : `Buy ${tier.name} (${tier.cost} 🪙)`}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ROW 3: EVENT SALES (COMING SOON) */}
        <div className="shop-section">
          <div className="shop-section-header">
            <h3>🎪 Event Sales &amp; Seasonal Bundles</h3>
          </div>
          <div className="event-sales-alcove">
            <span className="event-coming-soon-badge">✨ Coming Soon ✨</span>
            <h4>Grand Galloping Gala &amp; Seasonal Specials</h4>
            <p>
              Limited-time holiday booster boxes, themed playmats, and discounted Mane Character collector bundles will appear here during Equestria Clash seasonal events!
            </p>
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
                    } tier-${(activePackTier?.key || 'sparkle').toLowerCase()}`}
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
                            <div className="flip-card-face flip-card-back">
                              <img src={CARD_BACK_URL} alt="Card Back" />
                              <span className="tap-to-flip-pill">Tap to Flip ✨</span>
                            </div>

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
                      style={{ width: 'auto', padding: '10px 26px' }}
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
    </div>
  );
}