import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import './StandingsHub.css';

interface RankInfo {
  tier: string;
  badge: string;
  color: string;
  isPlacement: boolean;
  placementsCompleted?: number;
  placementsRequired?: number;
}

interface PlayerProfile {
  user_id: string;
  username: string;
  display_name: string;
  mmr: number;
  peak_mmr: number;
  placement_matches: number;
  wins: number;
  losses: number;
  win_streak: number;
  rank: RankInfo;
}

interface LeaderboardEntry extends PlayerProfile {
  position: number;
}

interface RecentMatch {
  id: string;
  winner_name: string;
  loser_name: string;
  winner_mmr_change: number;
  loser_mmr_change: number;
  played_at: string;
}

interface StandingsHubProps {
  currentUser: {
    id?: string | number;
    username?: string;
    displayName?: string;
  } | null;
  onQueueRanked?: () => void;
}

const TIER_LIST = [
  { name: 'Bronze Foal', badge: '🥉', range: '< 1100 MMR', color: '#d97706' },
  { name: 'Silver Filly', badge: '🥈', range: '1100 – 1249', color: '#cbd5e1' },
  { name: 'Gold Unicorn', badge: '🦄', range: '1250 – 1399', color: '#fbbf24' },
  { name: 'Platinum Pegasus', badge: '🪽', range: '1400 – 1549', color: '#e2e8f0' },
  { name: 'Diamond Alicorn', badge: '💎', range: '1550 – 1699', color: '#38bdf8' },
  { name: 'Grand Princess', badge: '👑', range: '1700+ MMR', color: '#fde047' },
];

export default function StandingsHub({ currentUser, onQueueRanked }: StandingsHubProps) {
  const [myProfile, setMyProfile] = useState<PlayerProfile | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([]);
  const [placementRequired, setPlacementRequired] = useState<number>(5);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};
    if (token && token !== 'null' && token !== 'undefined') {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const [standingsRes, meRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/ranked/standings`, { credentials: 'include' }),
        currentUser?.id
          ? fetch(`${API_BASE_URL}/api/ranked/me`, { headers, credentials: 'include' })
          : Promise.resolve(null),
      ]);

      if (standingsRes.ok) {
        const sData = await standingsRes.json();
        setLeaderboard(sData.leaderboard || []);
        setRecentMatches(sData.recentMatches || []);
        setPlacementRequired(sData.placementRequired || 5);
      }

      if (meRes && meRes.ok) {
        const mData = await meRes.json();
        if (mData.profile) setMyProfile(mData.profile);
      }
    } catch (err) {
      console.error('Error loading ranked standings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentUser?.id]);

  const completedPlacements = Math.min(placementRequired, myProfile?.placement_matches || 0);
  const isSeeded = (myProfile?.placement_matches || 0) >= placementRequired;

  return (
    <div className="standings-container">
      <div className="standings-wrapper">
        {/* Header */}
        <div className="standings-header">
          <div>
            <h1>🏆 Equestrian Ranked Standings</h1>
            <span className="standings-subtitle">
              Complete {placementRequired} seeding placement matches to earn your official Equestrian Tier
            </span>
          </div>
          {onQueueRanked && (
            <button className="build-new-btn" onClick={onQueueRanked}>
              ⚔️ Play Ranked Match ✨
            </button>
          )}
        </div>

        {/* Logged-in Player Placement / Rank Card */}
        {currentUser?.id && myProfile && (
          <div className="my-rank-banner">
            <div>
              <div style={{ fontSize: '12px', color: '#e9d5ff', fontWeight: 800, textTransform: 'uppercase' }}>
                Your Competitive Status • {myProfile.display_name || myProfile.username}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                <span style={{ fontSize: '28px' }}>{myProfile.rank.badge}</span>
                <span style={{ fontSize: '24px', fontWeight: 900, color: myProfile.rank.color }}>
                  {myProfile.rank.tier}
                </span>
                {isSeeded && (
                  <span style={{ fontSize: '16px', color: '#ffd700', fontWeight: 900 }}>
                    ({myProfile.mmr} MMR)
                  </span>
                )}
              </div>

              {!isSeeded ? (
                <div>
                  <div style={{ fontSize: '13px', color: '#fbcfe8', marginTop: '6px', fontWeight: 700 }}>
                    Seeding Progress: <strong>{completedPlacements} / {placementRequired}</strong> Placement Matches Played
                    {' '}({placementRequired - completedPlacements} remaining to reveal rank)
                  </div>
                  <div className="placement-pip-row">
                    {Array.from({ length: placementRequired }).map((_, idx) => (
                      <div
                        key={idx}
                        className={`placement-pip ${idx < completedPlacements ? 'completed' : ''}`}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '13px', color: '#fbcfe8', marginTop: '6px', fontWeight: 700 }}>
                  Record: <strong>{myProfile.wins}W – {myProfile.losses}L</strong> • Peak Rating: <strong>{myProfile.peak_mmr} MMR</strong>
                  {myProfile.win_streak >= 2 && (
                    <span style={{ color: '#4ade80', marginLeft: '10px' }}>
                      🔥 {myProfile.win_streak} Win Streak!
                    </span>
                  )}
                </div>
              )}
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', color: '#c4b5fd', fontWeight: 800 }}>SEEDING CALIBRATION</div>
              <div style={{ fontSize: '13px', color: '#fde047', fontWeight: 900 }}>
                {isSeeded ? '✅ Seeded on Leaderboard' : '🔮 High-Volatility Calibration Active'}
              </div>
            </div>
          </div>
        )}

        {/* Tier Threshold Overview */}
        <div className="tier-legend-grid">
          {TIER_LIST.map((t) => (
            <div key={t.name} className="tier-pill-card">
              <div style={{ fontSize: '20px' }}>{t.badge}</div>
              <div style={{ fontWeight: 900, fontSize: '13px', color: t.color }}>{t.name}</div>
              <div style={{ fontSize: '11.5px', color: '#c4b5fd', fontWeight: 700 }}>{t.range}</div>
            </div>
          ))}
        </div>

        {/* Main Leaderboard Table */}
        <div className="standings-table-card">
          <h2 style={{ margin: '0 0 14px 0', color: '#ffd700', fontSize: '20px' }}>
            🌟 Top Seeded Duelists
          </h2>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#ffd700' }}>
              <strong>Loading Ranked Standings... ✨</strong>
            </div>
          ) : leaderboard.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#fbcfe8' }}>
              No players have finished their {placementRequired} seeding placement matches yet. Queue into Ranked Mode to claim #1!
            </div>
          ) : (
            <table className="standings-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Player</th>
                  <th>Tier</th>
                  <th>Rating (MMR)</th>
                  <th>W / L</th>
                  <th>Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry) => {
                  const total = entry.wins + entry.losses;
                  const winPct = total > 0 ? Math.round((entry.wins / total) * 100) : 0;
                  const topClass =
                    entry.position === 1
                      ? 'top-1'
                      : entry.position === 2
                      ? 'top-2'
                      : entry.position === 3
                      ? 'top-3'
                      : '';

                  return (
                    <tr key={entry.user_id}>
                      <td>
                        <span className={`rank-pos-badge ${topClass}`}>#{entry.position}</span>
                      </td>
                      <td style={{ color: '#fff' }}>
                        {entry.display_name || entry.username}
                        {entry.win_streak >= 3 && (
                          <span style={{ marginLeft: '8px', fontSize: '12px', color: '#4ade80' }}>
                            🔥{entry.win_streak}
                          </span>
                        )}
                      </td>
                      <td style={{ color: entry.rank.color }}>
                        {entry.rank.badge} {entry.rank.tier}
                      </td>
                      <td style={{ color: '#ffd700', fontWeight: 900 }}>{entry.mmr}</td>
                      <td>
                        <span style={{ color: '#4ade80' }}>{entry.wins}W</span> –{' '}
                        <span style={{ color: '#f87171' }}>{entry.losses}L</span>
                      </td>
                      <td style={{ color: '#e9d5ff' }}>{winPct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent Ranked Matches Feed */}
        {recentMatches.length > 0 && (
          <div className="standings-table-card">
            <h3 style={{ margin: '0 0 12px 0', color: '#ffd700', fontSize: '18px' }}>
              ⚔️ Recent Ranked Results
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recentMatches.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                    background: 'rgba(20, 6, 34, 0.65)',
                    padding: '10px 16px',
                    borderRadius: '14px',
                    fontSize: '13.5px',
                  }}
                >
                  <div>
                    <strong style={{ color: '#4ade80' }}>{m.winner_name}</strong>{' '}
                    <span style={{ color: '#ffd700' }}>(+{m.winner_mmr_change})</span>{' '}
                    <span style={{ color: '#c4b5fd' }}>defeated</span>{' '}
                    <strong style={{ color: '#f87171' }}>{m.loser_name}</strong>{' '}
                    <span style={{ color: '#fda4af' }}>({m.loser_mmr_change})</span>
                  </div>
                  <span style={{ fontSize: '12px', color: '#c4b5fd' }}>
                    {new Date(m.played_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}