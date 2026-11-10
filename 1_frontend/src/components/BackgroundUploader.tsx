import React, { useState } from 'react';
import './BackgroundUploader.css';

interface Props {
  tabKey: string;
}

export default function BackgroundUploader({ tabKey }: Props) {
  const [bgImage, setBgImage] = useState<string>(localStorage.getItem(`bg_${tabKey}`) || '');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setBgImage(result);
        localStorage.setItem(`bg_${tabKey}`, result);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearBackground = () => {
    setBgImage('');
    localStorage.removeItem(`bg_${tabKey}`);
  };

  return (
    <div className="bg-uploader-widget">
      <label className="bg-upload-label">
        🖼️ Customize Tab Background
        <input type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
      </label>
      {bgImage && (
        <button onClick={clearBackground} className="bg-clear-btn">Reset BG</button>
      )}
      {/* Apply dynamic background to parent tab container */}
      {/* Inline style injector via useEffect or wrapper */}
    </div>
  );
}