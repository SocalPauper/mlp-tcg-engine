import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';

export const Signup: React.FC = () => {
  const [formData, setFormData] = useState({
    username: '',
    displayName: '',
    age: '',
    email: '',
    password: ''
  });
  
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // Use direct native fetch to bypass any axios instance wrapper discrepancies
      const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Registration failed.');
      }
      
      setSuccessMessage('Account created successfully! Please check your email to verify your account.');
      
      setTimeout(() => {
        navigate('/login');
      }, 4000);

    } catch (err: any) {
      console.error('Registration error:', err);
      // Safely ensure error message is rendered as a clean primitive string
      const errorMessage = typeof err?.message === 'string' ? err.message : 'An unexpected error occurred during registration.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signup-container">
      <form onSubmit={handleRegister} className="signup-form">
        <h2>Create Account</h2>

        {error && <div className="error-banner" style={{ backgroundColor: '#7f1d1d', color: '#fff', padding: '10px', marginBottom: '15px', borderRadius: '4px' }}>{error}</div>}
        {successMessage && <div className="success-banner" style={{ backgroundColor: '#065f46', color: '#fff', padding: '10px', marginBottom: '15px', borderRadius: '4px' }}>{successMessage}</div>}

        <div className="form-group">
          <label>USERNAME (Unique)</label>
          <input type="text" name="username" value={formData.username} onChange={handleChange} required />
        </div>

        <div className="form-group">
          <label>DISPLAY NAME</label>
          <input type="text" name="displayName" value={formData.displayName} onChange={handleChange} required />
        </div>

        <div className="form-group">
          <label>AGE</label>
          <input type="number" name="age" value={formData.age} onChange={handleChange} required />
        </div>

        <div className="form-group">
          <label>EMAIL (Optional for Safe Mode access)</label>
          <input type="email" name="email" value={formData.email} onChange={handleChange} />
        </div>

        <div className="form-group">
          <label>PASSWORD</label>
          <input type="password" name="password" value={formData.password} onChange={handleChange} required />
        </div>

        <button type="submit" disabled={loading} className="submit-btn">
          {loading ? 'Processing...' : 'Register Account'}
        </button>
      </form>
    </div>
  );
};

export default Signup;