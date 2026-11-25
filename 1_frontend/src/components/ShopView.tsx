import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { useAuth } from '../App';
import { getCardFoilClass } from '../styles/cardFoil';
import CardPreviewModal, {
  PreviewableCard,
  invalidatePreviewCollectionCache,
} from './CardPreviewModal';
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
  convertedToDust?: number;
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
  const [pityCounter, setPityCounter] = useState<number>(0);
  const [weekId, setWeekId] = useState<string>('');
  const [deals, setDeals] = useState<WeeklyDeal[]>([]);
  const [tiers, setTiers] = useState<Record<string, any>>({});
  const [ownedQuantities, setOwnedQuantities] = useState<Record<string, number>>({});
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
  const [autoDustBanner, setAutoDustBanner] = useState<number>(0);
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

  const getMaxCopiesForCard = (cardType?: string) => {
    const t = String(cardType || '').toLowerCase();
    return t.includes('mane') || t.includes('main') ? 1 : 4;
  };

  const getOwnedCount = (card: { id: string; card_type?: string; rarity?: string }) => {
    const maxPlayset = getMaxCopiesForCard(card.card_type);
    if (ownedQuantities[card.id] !== undefined) {
      return Number(ownedQuantities[card.id]) || 0;
    }
    const id = String(card.id || '').toUpperCase();
    const rarity = String(card.rarity || 'C').toUpperCase();
    if (id.endsWith('-S')) return 0;
    if (/^SD/i.test(id) || ['C', 'U', 'R', 'SPR'].includes(rarity)) return maxPlayset;
    return 0;
  };

  const fetchShopData = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const [shopRes, collectionRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/shop/status`, { headers }),
        token
          ? axios.get(`${API_BASE_URL}/api/auth/me/collection`, { headers }).catch(() => null)
          : Promise.resolve(null),
      ]);

      const data = shopRes.data;
      syncPoints(data.reward_points);
      setPityCounter(data.pityCounter ?? 0);
      setWeekId(data.weekId || '');
      setDeals(data.weeklyDeals || []);
      setTiers(data.tiers || {});
      if (data.tradeInSummary) {
        setTradeInSummary(data.tradeInSummary);
      }

      const mergedOwned: Record<string, number> = { ...(data.ownedQuantities || {}) };
      if (collectionRes && Array.isArray(collectionRes.data)) {
        for (const row of collectionRes.data) {
          if (row?.card_id) {
            mergedOwned[row.card_id] = Number(row.quantity) || 0;
          }
        }
      }
      setOwnedQuantities(mergedOwned);
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
      setMessage('Not enough Pony Points! Play public matches or sell back extra copies to earn points.');
      return;
    }
    setPurchasing(true);
    setMessage(null);
    setAutoDustBanner(0);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_BASE_URL}/api/shop/buy-pack`,
        { tier: tierKey },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      syncPoints(data.remainingPoints);
      if (data.pityCounter !== undefined) setPityCounter(data.pityCounter);
      if (data.tradeInSummary) setTradeInSummary(data.tradeInSummary);
      if (data.ownedQuantities) {
        setOwnedQuantities((prev) => ({ ...prev, ...data.ownedQuantities }));
      }
      invalidatePreviewCollectionCache();
      if (data.autoDustEarned > 0) setAutoDustBanner(data.autoDustEarned);
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
    setAutoDustBanner(0);
  };

  const handleBuyDeal = async (deal: WeeklyDeal) => {
    const maxPlayset = getMaxCopiesForCard(deal.card_type);
    const prevOwned = getOwnedCount({
      id: deal.card_id,
      card_type: deal.card_type,
      rarity: deal.rarity,
    });

    if (prevOwned >= maxPlayset) {
      setMessage(`You already own the maximum playset (${prevOwned}/${maxPlayset}) of ${deal.name}!`);
      return;
    }

    if (points < deal.price) {
      setMessage('Not enough Pony Points for this weekly deal.');
      return;
    }

    setPurchasing(true);
    setMessage(null);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(
        `${API_BASE_URL}/api/shop/buy-deal`,
        { dealId: deal.id },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      syncPoints(data.remainingPoints);
      if (data.tradeInSummary) setTradeInSummary(data.tradeInSummary);

      const resolvedQty = Math.min(
        maxPlayset,
        typeof data.newQuantity === 'number' ? data.newQuantity : prevOwned + 1
      );
      const resolvedMax =
        typeof data.maxPlayset === 'number' ? data.maxPlayset : maxPlayset;

      setOwnedQuantities((prev) => ({
        ...prev,
        ...(data.ownedQuantities || {}),
        [deal.card_id]: resolvedQty,
      }));
      invalidatePreviewCollectionCache();
      setMessage(
        `Added 1 copy of ${deal.name} (${resolvedQty}/${resolvedMax} owned)!`
      );
      await fetchShopData();
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Failed to buy deal.');
      await fetchShopData();
    } finally {
      setPurchasing(false);
    }
  };

  const handleTradeInExtras = async () => {
    if (tradeInSummary.extraCardsCount <= 0) return;
    if (
      !window.confirm(
        `Sell back ${tradeInSummary.extraCardsCount} extra card(s) beyond your 4-card playsets for +${tradeInSummary.totalPointsValue} Pony Points?`
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
      if (data.ownedQuantities) {
        setOwnedQuantities((prev) => ({ ...prev, ...data.ownedQuantities }));
      }
      invalidatePreviewCollectionCache();
      setMessage(
        `Sold back ${data.tradedCount} extra copy/copies beyond 4x playsets for +${data.pointsEarned} Pony Points!`
      );
      await fetchShopData();
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Failed to sell back extra cards.');
    } finally {
      setPurchasing(false);
    }
  };

  if (loading) {
    return (
      <div className="shop-viewport">
        <div className="shop-loading">Opening the Canterlot Pony Point Shop...</div>
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

  const getPackVisualClass = (key: string) => {
    const k = key.toLowerCase();
    if (k === 'shining') return 'tier-harmony';
    if (k === 'bundle') return 'tier-royal';
    return 'tier-sparkle';
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
        <CardPreviewModal
          card={previewCard}
          ownedCount={previewCard ? getOwnedCount(previewCard) : undefined}
          onClose={() => setPreviewCard(null)}
        />

        <div className="shop-header">
          <div>
            <h2>The Pony Point Shop</h2>
            <span className="shop-subtitle">
              All C, U, R &amp; SPR cards are free! Spend Pony Points on high-rarity chase packs &amp; Shining foils
            </span>
          </div>

          <div className="shop-header-actions">
            <span
              className="week-tag"
              title="Guaranteed CR, Shining (-S), or GR every 10th Standard chase slot"
            >
              CR+ Pity: {pityCounter}/10
            </span>

            <button
              type="button"
              className="trade-in-btn"
              disabled={purchasing || tradeInSummary.extraCardsCount <= 0}
              onClick={handleTradeInExtras}
              title="Convert any cards with more than 4 copies in your collection into Pony Points"
            >
              {tradeInSummary.extraCardsCount > 0
                ? `Sell Back ${tradeInSummary.extraCardsCount} Extra(s) (+${tradeInSummary.totalPointsValue} Pts)`
                : '4x Playset Protection Active'}
            </button>

            <div className="shop-points-badge">
              Pony Points: <strong>{points}</strong>
            </div>
          </div>
        </div>

        {message && <div className="shop-message-banner">{message}</div>}

        <div className="shop-section">
          <div className="shop-section-header">
            <h3>Cards of the Week</h3>
            {weekId && <span className="week-tag">Auto-Rotating • {weekId}</span>}
          </div>
          <p className="shop-section-desc">
            Spotlighted single cards available up to a full playset (4x standard / 1x Mane Character). Click any card to inspect its rules!
          </p>

          <div className="weekly-easels-grid">
            {deals.map((deal) => {
              const maxCopies = getMaxCopiesForCard(deal.card_type);
              const owned = Math.min(
                maxCopies,
                getOwnedCount({
                  id: deal.card_id,
                  card_type: deal.card_type,
                  rarity: deal.rarity,
                })
              );
              const isMaxed = owned >= maxCopies;

              return (
                <div key={deal.id} className="easel-stage">
                  <div className="easel-spotlight-beam" aria-hidden="true" />
                  <span className="easel-rarity-pill">
                    {deal.card_id.endsWith('-S') ? `${deal.rarity}-S` : deal.rarity}
                  </span>

                  <div className="mini-easel-assembly">
                    <div className="easel-top-finial" />
                    <div
                      className={`easel-card-canvas ${getCardFoilClass({
                        id: deal.card_id,
                        rarity: deal.rarity,
                      })}`}
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
                    <div
                      style={{
                        fontSize: '0.82rem',
                        fontWeight: 900,
                        color: isMaxed ? '#6ee7b7' : '#fde047',
                        marginBottom: '10px',
                      }}
                    >
                      Copies Owned: {owned} / {maxCopies}
                    </div>
                    <button
                      type="button"
                      className="shop-buy-btn deal-btn"
                      disabled={purchasing || isMaxed}
                      onClick={() => handleBuyDeal(deal)}
                    >
                      {isMaxed
                        ? `Max Playset (${owned}/${maxCopies})`
                        : `Buy Copy (${deal.price} Pts)`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="shop-section">
          <div className="shop-section-header">
            <h3>Shiny Foil Booster Packs (SR, UR, CR, GR, DR &amp; Shining -S)</h3>
          </div>
          <p className="shop-section-desc">
            Excess copies beyond a <strong>4-card playset</strong> automatically convert into Pony Points dust!
          </p>

          <div className="packs-showcase-grid">
            {Object.entries(tiers).map(([key, tier]) => (
              <div key={key} className="pack-showcase-column">
                <div
                  className={`shiny-foil-pack ${getPackVisualClass(key)}`}
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
                    <div className="foil-pack-cost-pill">{tier.cost} Pts</div>
                  </div>
                  <div className="foil-pack-crimp bottom" />
                </div>

                <div className="pack-distribution-box">
                  <div className="pack-dist-header">
                    <h4>{tier.name}</h4>
                    <span className="pack-dist-cost">{tier.cost} Pts</span>
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
                    {purchasing ? 'Summoning Pack...' : `Buy ${tier.name} (${tier.cost} Pts)`}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="shop-section">
          <div className="shop-section-header">
            <h3>Sell Back Extra Copies (Beyond 4x Playset)</h3>
            <span className="week-tag">
              {tradeInSummary.extraCardsCount > 0
                ? `${tradeInSummary.extraCardsCount} Extra(s) Ready`
                : '0 Extras Found'}
            </span>
          </div>
          <p className="shop-section-desc">
            Convert any duplicate cards beyond a full <strong>4-card playset</strong> (or 1x for Mane Characters) back into Pony Points:{' '}
            <strong>SR: 20 • SSR: 35 • UR: 50 • CR: 60 • DR: 80 • GR / Shining (-S): 100</strong>
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="trade-in-btn"
              disabled={purchasing || tradeInSummary.extraCardsCount <= 0}
              onClick={handleTradeInExtras}
            >
              {tradeInSummary.extraCardsCount > 0
                ? `Sell Back ${tradeInSummary.extraCardsCount} Extra Card(s) for +${tradeInSummary.totalPointsValue} Pts`
                : 'No Extra Copies Beyond 4x Playset to Sell Back'}
            </button>
          </div>
        </div>

        <div className="shop-section">
          <div className="shop-section-header">
            <h3>Event Sales &amp; Seasonal Bundles</h3>
          </div>
          <div className="event-sales-alcove">
            <span className="event-coming-soon-badge">Coming Soon</span>
            <h4>Grand Galloping Gala &amp; Seasonal Specials</h4>
            <p>
              Limited-time holiday booster boxes, themed playmats, and discounted Mane Character collector bundles will appear here during Equestria Clash seasonal events!
            </p>
          </div>
        </div>

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
                  <h3>{activePackTier?.name || 'Booster Pack'} Ready!</h3>
                  <p>Click the booster pack or tear along the foil strip to rip it open!</p>

                  <div
                    className={`booster-foil-wrapper ${
                      packStage === 'RIPPING' ? 'ripping-active' : 'sealed-idle'
                    } ${getPackVisualClass(activePackTier?.key || 'standard')}`}
                    onClick={handleRipPack}
                  >
                    <div className="booster-foil-top-flap">
                      <span className="foil-crimp-lines" />
                      <span className="foil-tear-hint">TEAR HERE</span>
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
                    {packStage === 'RIPPING' ? 'Ripping Foil...' : 'Rip Open Pack!'}
                  </button>
                </div>
              ) : (
                <>
                  <h3>Tap to Flip — Click Revealed Cards to Preview!</h3>
                  <p>
                    Click a face-down card to flip it, or click an open card to inspect its rules text.
                    {autoDustBanner > 0 && (
                      <strong style={{ color: '#fde047', display: 'block', marginTop: '4px' }}>
                        Excess 5th+ copies converted into +{autoDustBanner} Pony Points!
                      </strong>
                    )}
                  </p>

                  <div className="pulled-cards-row">
                    {pulledCards.map((card, idx) => {
                      const isFlipped = Boolean(flippedIndices[idx]);
                      const foilCls = getCardFoilClass(card);
                      const isUltra = Boolean(foilCls);
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
                              <span className="tap-to-flip-pill">Tap to Flip</span>
                            </div>

                            <div className={`flip-card-face flip-card-front ${foilCls}`}>
                              <span className={`pulled-rarity rarity-${card.rarity.toLowerCase()}`}>
                                {card.id.endsWith('-S') ? `${card.rarity}-S` : card.rarity}
                              </span>
                              <img src={card.image_url || CARD_BACK_URL} alt={card.name} />
                              <h5>{card.name}</h5>
                              <span>
                                {card.convertedToDust
                                  ? `+${card.convertedToDust} Dust`
                                  : 'Click to Preview'}
                              </span>
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
                        Reveal All Cards
                      </button>
                    )}
                    <button
                      type="button"
                      className="shop-buy-btn"
                      style={{ width: 'auto', padding: '10px 26px' }}
                      onClick={closePackModal}
                    >
                      {allRevealed ? 'Awesome, Collect!' : 'Collect & Close'}
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