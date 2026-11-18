import React, { useState } from 'react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../App';
import './BackgroundUploader.css';

interface Props {
  tabKey: string;
  currentUrl?: string;
  onUploaded?: (newUrl: string) => void;
}

export default function BackgroundUploader({ tabKey, currentUrl, onUploaded }: Props) {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', 'theme_bg');
      formData.append('targetKey', tabKey);
      formData.append('uploadedBy', user?.username || 'admin');

      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/api/media/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Upload failed');
      }

      if (onUploaded) onUploaded(data.publicUrl);
      alert(`Global background updated for "${tabKey}"! All users will now see this wallpaper.`);
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const clearBackground = async () => {
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_BASE_URL}/api/media/settings/bg_${tabKey}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (onUploaded) onUploaded('');
      alert(`Global background reset for "${tabKey}".`);
    } catch {
      alert('Failed to reset background.');
    }
  };

  return (
    <div className="bg-uploader-widget">
      <label className="bg-upload-label">
        {uploading ? '⏳ Uploading to R2...' : '🖼️ Upload Global Wallpaper'}
        <input
          type="file"
          accept="image/*"
          disabled={uploading}
          onChange={handleFileUpload}
          style={{ display: 'none' }}
        />
      </label>
      {currentUrl && (
        <button type="button" onClick={clearBackground} className="bg-clear-btn">
          Reset BG
        </button>
      )}
    </div>
  );
}