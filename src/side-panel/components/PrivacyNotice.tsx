import React from 'react';

export const PRIVACY_NOTICE_SESSION_KEY = 'coursechat-privacy-notice-acknowledged';

export function PrivacyNotice({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <div style={{ marginBottom: '16px', background: '#fef7e0', padding: '14px', borderRadius: '10px', border: '1px solid #fdd835' }}>
      <strong style={{ fontSize: '14px' }}>Privacy notice</strong>
      <p style={{ fontSize: '12px', margin: '6px 0 0', color: '#555', lineHeight: 1.5 }}>
        Course text you ask about may be sent to external servers for processing and answering.
        Do not continue if you are not comfortable with that.
      </p>
      <button
        type="button"
        onClick={onAcknowledge}
        style={{
          marginTop: '10px',
          padding: '7px 12px',
          background: '#1a73e8',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          fontSize: '12px',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        I understand
      </button>
    </div>
  );
}
