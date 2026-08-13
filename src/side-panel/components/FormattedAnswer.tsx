import React from 'react';

export function FormattedAnswer({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    let content: React.ReactNode = line;
    if (line.includes('**')) {
      const parts = line.split(/\*\*(.*?)\*\*/g);
      content = parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part);
    }
    if (line.match(/^\s*[\*\-]\s/)) {
      const bulletText = line.replace(/^\s*[\*\-]\s/, '');
      let bulletContent: React.ReactNode = bulletText;
      if (bulletText.includes('**')) {
        const parts = bulletText.split(/\*\*(.*?)\*\*/g);
        bulletContent = parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part);
      }
      elements.push(<div key={i} style={{ paddingLeft: '12px', marginBottom: '4px' }}>• {bulletContent}</div>);
      return;
    }
    if (line.trim() === '') { elements.push(<div key={i} style={{ height: '8px' }} />); return; }
    if (line.startsWith('*Source:') || line.startsWith('(*') || line.startsWith('*(')) {
      elements.push(<div key={i} style={{ fontSize: '11px', color: '#1a73e8', marginTop: '8px', fontStyle: 'italic' }}>{content}</div>);
      return;
    }
    elements.push(<div key={i} style={{ marginBottom: '2px' }}>{content}</div>);
  });

  return <>{elements}</>;
}