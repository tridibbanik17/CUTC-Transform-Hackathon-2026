import React from 'react';

export function Spinner() {
  return (
    <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid #e0e0e0', borderTopColor: '#1a73e8', borderRadius: '50%', animation: 'spin 0.8s linear infinite', verticalAlign: 'middle', marginRight: '8px' }} />
  );
}