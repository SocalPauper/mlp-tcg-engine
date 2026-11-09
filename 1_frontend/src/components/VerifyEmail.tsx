import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../config'; // Your configured axios instance

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
        setMessage('No verification token provided.');
        return;
      }

      try {
        const response = await api.get(`/auth/verify?token=${token}`);
        setStatus('success');
        setMessage(response.data.message || 'Email verified successfully!');
        
        // Automatically redirect to login after 3 seconds
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      } catch (err: any) {
        setStatus('error');
        if (err.response && err.response.data && err.response.data.message) {
          setMessage(err.response.data.message);
        } else {
          setMessage('Verification failed. The token may be invalid or expired.');
        }
      }
    };

    verifyToken();
  }, [token, navigate]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#1a1c23', color: '#fff', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ padding: '40px', background: '#242736', borderRadius: '8px', textAlign: 'center', maxWidth: '400px', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
        <h2 style={{ color: status === 'success' ? '#10b981' : status === 'error' ? '#ef4444' : '#8b5cf6' }}>
          {status === 'verifying' && 'Processing...'}
          {status === 'success' && 'Verification Success!'}
          {status === 'error' && 'Verification Failed'}
        </h2>
        <p style={{ marginTop: '15px', color: '#d1d5db' }}>{message}</p>
        {status === 'success' && (
          <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '20px' }}>Redirecting to login...</p>
        )}
      </div>
    </div>
  );
};