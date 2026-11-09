import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { useAuth } from '../context/AuthContext';

export const VerifyEmail: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [statusMessage, setStatusMessage] = useState('Verifying your email...');
  const [isSuccess, setIsSuccess] = useState(false);
  const { user, login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      setStatusMessage('Missing verification token.');
      return;
    }

    fetch(`${API_BASE_URL}/api/auth/verify?token=${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Verification failed.');
        
        setIsSuccess(true);
        setStatusMessage(data.message || 'Email verified successfully!');

        // Update local session state to lift Safe Mode
        if (user) {
          const updatedUser = { ...user, isSafeMode: false };
          login(updatedUser, localStorage.getItem('token') || 'dummy-jwt-token');
        }

        setTimeout(() => navigate('/'), 3000);
      })
      .catch((err) => {
        setIsSuccess(false);
        setStatusMessage(err.message || 'An error occurred during verification.');
      });
  }, [token, navigate, user, login]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div style={{ background: '#1f2937', padding: '32px', borderRadius: '16px', width: '100%', maxWidth: '450px', color: '#fff', textAlign: 'center', border: '1px solid #374151' }}>
        <h2 style={{ marginBottom: '16px', color: isSuccess ? '#34d399' : '#f472b6' }}>Email Verification</h2>
        <p style={{ fontSize: '0.95rem', color: '#d1d5db' }}>{statusMessage}</p>
      </div>
    </div>
  );
};

export default VerifyEmail;