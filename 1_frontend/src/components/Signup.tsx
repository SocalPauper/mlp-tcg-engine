import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Signup() {
  const [formData, setFormData] = useState({
    username: '',
    displayName: '',
    age: '',
    email: '',
    password: ''
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await register({
        ...formData,
        age: parseInt(formData.age, 10)
      });
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '70vh' }}>
      <form onSubmit={handleSignup} style={{ background: '#1f2937', padding: '32px', borderRadius: '16px', width: '100%', maxWidth: '420px', color: '#fff', border: '1px solid #374151', boxSizing: 'border-box' }}>
        <h2 style={{ marginBottom: '24px', color: '#f472b6', textAlign: 'center' }}>Create Account</h2>
        {error && <div style={{ backgroundColor: '#7f1d1d', padding: '10px', marginBottom: '16px', borderRadius: '6px', fontSize: '0.85rem' }}>{error}</div>}
        
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '6px', color: '#9ca3af' }}>USERNAME (Unique)</label>
          <input type="text" name="username" value={formData.username} onChange={handleChange} placeholder="Choose a username" required style={{ width: '100%', padding: '10px', background: '#111827', border: '1px solid #374151', borderRadius: '8px', color: '#fff', boxSizing: 'border-box' }} />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '6px', color: '#9ca3af' }}>DISPLAY NAME</label>
          <input type="text" name="displayName" value={formData.displayName} onChange={handleChange} placeholder="Your display name" required style={{ width: '100%', padding: '10px', background: '#111827', border: '1px solid #374151', borderRadius: '8px', color: '#fff', boxSizing: 'border-box' }} />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '6px', color: '#9ca3af' }}>AGE</label>
          <input type="number" name="age" value={formData.age} onChange={handleChange} placeholder="Your age" required min="1" max="120" style={{ width: '100%', padding: '10px', background: '#111827', border: '1px solid #374151', borderRadius: '8px', color: '#fff', boxSizing: 'border-box' }} />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '6px', color: '#9ca3af' }}>EMAIL (Required for Safe Mode removal if age 13+)</label>
          <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="Your email address" style={{ width: '100%', padding: '10px', background: '#111827', border: '1px solid #374151', borderRadius: '8px', color: '#fff', boxSizing: 'border-box' }} />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '6px', color: '#9ca3af' }}>PASSWORD</label>
          <input type="password" name="password" value={formData.password} onChange={handleChange} placeholder="Choose a secure password" required style={{ width: '100%', padding: '10px', background: '#111827', border: '1px solid #374151', borderRadius: '8px', color: '#fff', boxSizing: 'border-box' }} />
        </div>

        <button type="submit" disabled={loading} style={{ width: '100%', padding: '12px', background: 'linear-gradient(to right, #db2777, #9333ea)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '16px' }}>
          {loading ? 'Creating Account...' : 'Register Account'}
        </button>

        <div style={{ textAlign: 'center', fontSize: '0.85rem' }}>
          <span style={{ color: '#9ca3af' }}>Already have an account? </span>
          <a href="/login" style={{ color: '#f472b6', textDecoration: 'none', fontWeight: 'bold' }}>Sign In</a>
        </div>
      </form>
    </div>
  );
}