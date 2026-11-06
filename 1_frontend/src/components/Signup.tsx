import React, { useState } from 'react';
import { API_BASE_URL } from '../config';

export default function Signup({ onAuthSuccess }: { onAuthSuccess: (user: any, token: string) => void }) {
  const [isLogin, setIsLogin] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [age, setAge] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    const payload = isLogin 
      ? { email, password } 
      : { username, displayName, email, password, age: parseInt(age, 10) };

    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      // Save token and user state
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onAuthSuccess(data.user, data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '4rem auto', background: '#1f2937', padding: '2rem', borderRadius: '1rem', border: '1px solid #374151', color: '#fff' }}>
      <h2 style={{ textAlign: 'center', color: '#f472b6', marginBottom: '1.5rem' }}>
        {isLogin ? 'Log In to Equestria Clash' : 'Create Account'}
      </h2>

      {error && (
        <div style={{ background: '#7f1d1d', border: '1px solid #991b1b', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {!isLogin && (
          <>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 'bold' }}>USERNAME (Unique)</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={{ width: '100%', marginTop: '0.25rem', background: '#111827', border: '1px solid #374151', borderRadius: '0.5rem', padding: '0.5rem', color: '#fff', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 'bold' }}>DISPLAY NAME</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                style={{ width: '100%', marginTop: '0.25rem', background: '#111827', border: '1px solid #374151', borderRadius: '0.5rem', padding: '0.5rem', color: '#fff', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 'bold' }}>AGE</label>
              <input
                type="number"
                required
                min="1"
                max="120"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                style={{ width: '100%', marginTop: '0.25rem', background: '#111827', border: '1px solid #374151', borderRadius: '0.5rem', padding: '0.5rem', color: '#fff', boxSizing: 'border-box' }}
              />
            </div>
          </>
        )}

        <div>
          <label style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 'bold' }}>EMAIL {isLogin ? '' : '(Optional for Safe Mode access)'}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', marginTop: '0.25rem', background: '#111827', border: '1px solid #374151', borderRadius: '0.5rem', padding: '0.5rem', color: '#fff', boxSizing: 'border-box' }}
          />
        </div>

        <div>
          <label style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 'bold' }}>PASSWORD</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', marginTop: '0.25rem', background: '#111827', border: '1px solid #374151', borderRadius: '0.5rem', padding: '0.5rem', color: '#fff', boxSizing: 'border-box' }}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{ background: 'linear-gradient(to right, #db2777, #9333ea)', color: '#fff', border: 'none', padding: '0.75rem', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer', marginTop: '0.5rem' }}
        >
          {loading ? 'Processing...' : isLogin ? 'Log In' : 'Register Account'}
        </button>
      </form>

      <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
        <button
          onClick={() => setIsLogin(!isLogin)}
          style={{ background: 'transparent', border: 'none', color: '#f472b6', cursor: 'pointer', fontSize: '0.875rem', textDecoration: 'underline' }}
        >
          {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  );
}