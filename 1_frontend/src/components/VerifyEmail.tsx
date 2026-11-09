import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../config'; // Correct relative path from components/ to src/config.ts

export const VerifyEmail: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('Verifying your email address...');
  const navigate = useNavigate();

  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setStatus('error');
        setMessage('No verification token provided in the link.');
        return;
      }

      try {
        // Uses the configured axios instance pointing to the backend API
        const response = await api.get(`/auth/verify?token=${token}`);
        
        setStatus('success');
        setMessage(response.data.message || 'Email verified successfully!');
        
        // Redirect to portal/login after 3 seconds on success
        setTimeout(() => {
          navigate('/');
        }, 3000);
      } catch (err: any) {
        setStatus('error');
        const errorMessage = err.response?.data?.message || err.message || 'Verification failed. The token may be invalid or expired.';
        setMessage(errorMessage);
      }
    };

    verifyToken();
  }, [token, navigate]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '70vh', color: '#fff' }}>
      <div style={{ padding: '40px', background: '#1f2937', border: '1px solid #374151', borderRadius: '1rem', textAlign: 'center', maxWidth: '420px', width: '100%', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' }}>
        <h2 style={{ color: status === 'success' ? '#10b981' : status === 'error' ? '#ef4444' : '#f472b6', marginBottom: '1rem' }}>
          {status === 'verifying' && 'Verifying Account...'}
          {status === 'success' && 'Account Verified!'}
          {status === 'error' && 'Verification Failed'}
        </h2>
        <p style={{ color: '#d1d5db', lineHeight: '1.5' }}>{message}</p>
        {status === 'success' && (
          <p style={{ fontSize: '0.8rem', color: '#9ca3af', marginTop: '20px' }}>Redirecting you to the portal...</p>
        )}
      </div>
    </div>
  );
};