import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import './ShopView.css';

interface CardItem {
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
  const [tiers, setTiers] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [pulledCards, setPulledCards] = useState<CardItem[] | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchShopData = async () => {
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.get(`${API_BASE_URL}/api/shop/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
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

  const handleBuyPack = async (tierKey: string, cost: number) => {
    if (points < cost) {
      setMessage('Not enough Pony Points! Play more matches to earn points.');
      return;
    }
    setPurchasing(true);
    setMessage(null);
    try {
      const token = localStorage.getItem('token');
      const { data } = await axios.post(`${API_BASE_URL}/api/shop/buy-pack`, { tier: tierKey }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      setPoints(data.remainingPoints);
      setPulledCards(data.cards);
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Failed to open pack.');
    } finally {
      setPurchasing(false);
    }
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
      const { data } = await axios.post(`${API_BASE_URL}/api/shop/buy-deal`, { dealId }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      setPoints(data.remainingPoints);
      setMessage(`Successfully unlocked guaranteed card: ${data.card.name}!`);
      fetchShopData();
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Failed to buy deal.');
    } finally {
      setPurchasing(false);
    }
  };

  if (loading) return <div className="shop-loading">Loading Pony Shop...</div>;

  return (
    <div className="shop-container">
      <div className="shop-header">
        <h2>✨ The Pony Point Shop ✨</h2>
        <div className="shop-points-badge">
          🪙 Pony Points: <strong>{points}</strong>
        </div>
      </div>

      {message && <div className="shop-message-banner">{message}</div>}

      {/* PACK TIERS SECTION */}
      <div className="shop-section">
        <h3>🎁 Booster Packs</h3>
        <p className="shop-section-desc">Choose a pack tier to unlock random cards for your stable collection!</p>
        
        <div className="pack-tiers-grid">
          {Object.entries(tiers).map(([key, tier: any]) => (
            <div key={key} className="pack-tier-card">
              <span className="pack-price-tag">{tier.cost} 🪙</span>
              <h4>{tier.name}</h4>
              <p>Contains {tier.size} card{tier.size > 1 ? 's' : ''} with randomized rarities.</p>
              <button 
                type="button" 
                className="shop-buy-btn" 
                disabled={purchasing}
                onClick={() => handleBuyPack(key, tier.cost)}
              >
                {purchasing ? 'Opening...' : `Buy Pack (${tier.cost} 🪙)`}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* WEEKLY FEATURED DEALS SECTION */}
      <div className="shop-section">
        <h3>🌟 Weekly Featured Deals</h3>
        <p className="shop-section-desc">Guaranteed high-rarity cards. Refreshed weekly!</p>

        <div className="weekly-deals-grid">
          {deals.map((deal) => (
            <div key={deal.id} className="deal-card">
              <span className="deal-rarity-badge">{deal.rarity}</span>
              <img src={deal.image_url || CARD_BACK_URL} alt={deal.name} className="deal-card-img" />
              <h4>{deal.name}</h4>
              <div className="deal-card-meta">{deal.card_type} • {deal.element}</div>
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

      {/* PACK OPEN REVEAL MODAL */}
      {pulledCards && (
        <div className="pack-reveal-backdrop" onClick={() => setPulledCards(null)}>
          <div className="pack-reveal-modal" onClick={(e) => e.stopPropagation()}>
            <h3>🎉 Pack Opened Successfully!</h3>
            <p>You received the following cards in your collection:</p>
            
            <div className="pulled-cards-row">
              {pulledCards.map((card, idx) => (
                <div key={idx} className="pulled-card-item">
                  <span className="pulled-rarity">{card.rarity}</span>
                  <img src={card.image_url || CARD_BACK_URL} alt={card.name} />
                  <h5>{card.name}</h5>
                  <span>{card.card_type}</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="action-bar-btn primary"
              style={{ marginTop: '16px', padding: '10px 24px' }}
              onClick={() => setPulledCards(null)}
            >
              Awesome, Collect!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}