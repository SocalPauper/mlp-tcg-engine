import React from 'react';
import './Home.css';

interface HomeProps {
  onStartDeckBuilder: () => void;
}

export default function Home({ onStartDeckBuilder }: HomeProps) {
  return (
    <div className="home-container">
      <div className="hero-section">
        <h1>Welcome to Equestria Clash TCG Online</h1>
        <p>Build, test, and manage your custom My Little Pony decks with real-time PostgreSQL synchronization.</p>
        <button className="primary-cta-btn" onClick={onStartDeckBuilder}>
          Launch Deck Builder
        </button>
      </div>
    </div>
  );
}