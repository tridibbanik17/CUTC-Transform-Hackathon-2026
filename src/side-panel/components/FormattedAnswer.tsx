import React from 'react';

export function FormattedAnswer({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Empty lines → spacer
    if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: '8px' }} />);
      continue;
    }

    // Source/citation line — attach inline to the previous bullet if possible
    if (line.match(/^\s*\*?\(?Source:|^\s*\(\*Source:|^\s*\*\(Source:/i)) {
      // Parse bold within citation text
      let citContent: React.ReactNode = line;
      if (line.includes('**')) {
        const parts = line.split(/\*\*(.*?)\*\*/g);
        citContent = parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part);
      }
      elements.push(
        <div key={i} style={{ paddingLeft: '12px', fontSize: '11px', color: '#1a73e8', marginTop: '2px', marginBottom: '6px', fontStyle: 'italic' }}>
          {citContent}
        </div>
      );
      continue;
    }

    // Bullet points
    if (line.match(/^\s*[\*\-]\s/)) {
      const bulletText = line.replace(/^\s*[\*\-]\s/, '');
      let bulletContent: React.ReactNode = bulletText;
      if (bulletText.includes('**')) {
        const parts = bulletText.split(/\*\*(.*?)\*\*/g);
        bulletContent = parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part);
      }

      // Check if the next line is an inline source citation — if so, include it
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      if (nextLine.match(/^\s*\*?\(?Source:|^\s*\(\*Source:|^\s*\*\(Source:/i)) {
        let citContent: React.ReactNode = nextLine;
        if (nextLine.includes('**')) {
          const parts = nextLine.split(/\*\*(.*?)\*\*/g);
          citContent = parts.map((part, j) => j % 2 === 1 ? <strong key={`c${j}`}>{part}</strong> : part);
        }
        elements.push(
          <div key={i} style={{ paddingLeft: '12px', marginBottom: '8px' }}>
            <div>• {bulletContent}</div>
            <div style={{ fontSize: '11px', color: '#1a73e8', marginTop: '2px', fontStyle: 'italic' }}>{citContent}</div>
          </div>
        );
        i++; // skip the source line since we consumed it
      } else {
        elements.push(<div key={i} style={{ paddingLeft: '12px', marginBottom: '4px' }}>• {bulletContent}</div>);
      }
      continue;
    }

    // Regular text with bold parsing
    let content: React.ReactNode = line;
    if (line.includes('**')) {
      const parts = line.split(/\*\*(.*?)\*\*/g);
      content = parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part);
    }
    elements.push(<div key={i} style={{ marginBottom: '2px' }}>{content}</div>);
  }

  return <>{elements}</>;
}