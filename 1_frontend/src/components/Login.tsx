import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Login failed.');

      login(data.user, 'dummy-jwt-token');
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during login.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <form onSubmit={handleLogin} style={{ background: '#1f2937', padding: '32px', borderRadius: '16px', width: '100%', maxWidth: '400px', color: '#fff', border: '1px solid #374151' }}>
        <h2 style={{ marginBottom: '24px', color: '#f472b6', textAlign: 'center' }}>Sign In</h2>
        {error && <div style={{ backgroundColor: '#7f1d1d', padding: '10px', marginBottom: '16px', borderRadius: '6px', fontSize: '0.85rem' }}>{error}</div>}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '6px', color: '#9ca3af' }}>USERNAME OR EMAIL</label>
          <input type="text" name="username" value={formData.username} onChange={handleChange} required style={{ width: '100%', padding: '10px', background: '#111827', border: '1px solid #374151', borderRadius: '8px', color: '#fff', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '6px', color: '#9ca3af' }}>PASSWORD</label>
          <input type="password" name="password" value={formData.password} onChange={handleChange} required style={{ width: '100%', padding: '10px', background: '#111827', border: '1px solid #374151', borderRadius: '8px', color: '#fff', boxSizing: 'border-box' }} />
        </div>
        <button type="submit" disabled={loading} style={{ width: '100%', padding: '12px', background: 'linear-gradient(to right, #db2777, #9333ea)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '16px' }}>
          {loading ? 'Signing In...' : 'Sign In'}
        </button>
        <div style={{ textAlign: 'center', fontSize: '0.85rem' }}>
          <span style={{ color: '#9ca3af' }}>Don't have an account? </span>
          <a href="/signup" style={{ color: '#f472b6', textDecoration: 'none', fontWeight: 'bold' }}>Register</a>
        </div>
      </form>
    </div>
  );
}