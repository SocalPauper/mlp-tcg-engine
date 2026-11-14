import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext'; // adjust path if your context is elsewhere
import './AuthModal.css';

interface AuthModalProps {
  onClose: () => void;
}

export default function AuthModal({ onClose }: AuthModalProps) {
  const [isLogin, setIsLogin] = useState(false); // Set to false to default to Create Account like your screenshot
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    displayName: '',
    age: '',
    email: ''
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        await login({ username: formData.username, password: formData.password });
      } else {
        await register({
          username: formData.username,
          displayName: formData.displayName,
          age: parseInt(formData.age, 10),
          email: formData.email,
          password: formData.password
        });
      }
      onClose(); // Close modal on success
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={e => e.stopPropagation()}>
        <h2>{isLogin ? 'Sign In' : 'Create Account'}</h2>
        
        {error && (
          <div style={{ backgroundColor: '#7f1d1d', padding: '10px', borderRadius: '6px', fontSize: '0.85rem', color: '#fff' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <input 
            type="text" 
            name="username" 
            placeholder={isLogin ? "Username or Email" : "Username"} 
            value={formData.username} 
            onChange={handleChange} 
            required 
          />
          
          {!isLogin && (
            <>
              <input 
                type="text" 
                name="displayName" 
                placeholder="Display Name" 
                value={formData.displayName} 
                onChange={handleChange} 
                required 
              />
              <input 
                type="number" 
                name="age" 
                placeholder="Age" 
                value={formData.age} 
                onChange={handleChange} 
                required 
                min="1" 
                max="120"
              />
              <input 
                type="email" 
                name="email" 
                placeholder="Email (Required for Safe Mode removal)" 
                value={formData.email} 
                onChange={handleChange} 
              />
            </>
          )}

          <input 
            type="password" 
            name="password" 
            placeholder="Password" 
            value={formData.password} 
            onChange={handleChange} 
            required 
          />

          <button 
            type="submit" 
            disabled={loading}
            style={{ 
              padding: '12px', 
              background: 'linear-gradient(to right, #db2777, #9333ea)', 
              color: '#fff', 
              border: 'none', 
              borderRadius: '8px', 
              fontWeight: 'bold', 
              cursor: 'pointer',
              marginTop: '8px'
            }}
          >
            {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Register')}
          </button>
        </form>

        <div className="toggle-auth-mode" onClick={() => { setIsLogin(!isLogin); setError(null); }}>
          {isLogin ? "Don't have an account? Register" : "Already have an account? Login"}
        </div>

        <button 
          onClick={onClose} 
          style={{
            padding: '10px',
            background: 'transparent',
            color: '#fbcfe8',
            border: '1px solid #9333ea',
            borderRadius: '8px',
            cursor: 'pointer',
            marginTop: '8px'
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}