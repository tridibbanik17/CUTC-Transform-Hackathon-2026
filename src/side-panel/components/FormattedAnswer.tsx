import React from 'react';

/**
 * Convert LaTeX math notation to readable Unicode text.
 * Handles common patterns: \times, \text{}, ^{}, _{}, \log_2, \frac, etc.
 */
function latexToUnicode(text: string): string {
  let result = text;

  // Remove $ delimiters
  result = result.replace(/\$/g, '');

  // \text{...} → just the text
  result = result.replace(/\\text\{([^}]*)\}/g, '$1');

  // \times → ×
  result = result.replace(/\\times/g, '×');

  // \log_2(...) → log₂(...)
  result = result.replace(/\\log_2/g, 'log₂');
  result = result.replace(/\\log_(\d)/g, (_, d) => `log${toSubscript(d)}`);

  // \frac{a}{b} → a/b
  result = result.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2');

  // Superscripts: ^{...} → Unicode superscript
  result = result.replace(/\^\{([^}]*)\}/g, (_, content) => toSuperscript(content));
  result = result.replace(/\^(\d+)/g, (_, digits) => toSuperscript(digits));

  // Subscripts: _{...} → Unicode subscript
  result = result.replace(/_\{([^}]*)\}/g, (_, content) => toSubscript(content));
  result = result.replace(/_(\d)/g, (_, d) => toSubscript(d));

  // \geq, \leq, \neq, \approx
  result = result.replace(/\\geq/g, '≥');
  result = result.replace(/\\leq/g, '≤');
  result = result.replace(/\\neq/g, '≠');
  result = result.replace(/\\approx/g, '≈');
  result = result.replace(/\\infty/g, '∞');
  result = result.replace(/\\pi/g, 'π');
  result = result.replace(/\\sum/g, '∑');
  result = result.replace(/\\sqrt\{([^}]*)\}/g, '√($1)');
  result = result.replace(/\\sqrt/g, '√');

  // Clean up any remaining backslash commands
  result = result.replace(/\\[a-zA-Z]+/g, '');

  return result;
}

const superscriptMap: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ',
};

const subscriptMap: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
};

function toSuperscript(s: string): string {
  return s.split('').map(c => superscriptMap[c] || c).join('');
}

function toSubscript(s: string): string {
  return s.split('').map(c => subscriptMap[c] || c).join('');
}

/**
 * Check if a line contains LaTeX ($ delimiters or common commands)
 */
function hasLatex(text: string): boolean {
  return /\$[^$]+\$|\\(?:times|text|frac|log|sqrt|sum|geq|leq|neq|approx|infty|pi)\b|\^\{|\^\\d|_\{/.test(text);
}

/**
 * Process inline formatting: bold (**...**) and LaTeX math
 */
function formatInline(text: string): React.ReactNode {
  // First convert any LaTeX to Unicode
  let processed = text;
  if (hasLatex(processed)) {
    // Process each $...$ segment
    processed = processed.replace(/\$([^$]+)\$/g, (_, math) => latexToUnicode(math));
    // Also handle undelimited LaTeX commands
    if (hasLatex(processed)) {
      processed = latexToUnicode(processed);
    }
  }

  // Then handle bold
  if (processed.includes('**')) {
    const parts = processed.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part);
  }

  return processed;
}

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

    // Markdown headings: ### Heading, ## Heading, # Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = formatInline(headingMatch[2]);
      const sizes = { 1: '16px', 2: '14px', 3: '13px' };
      elements.push(
        <div key={i} style={{ fontWeight: 700, fontSize: sizes[level as 1|2|3] || '13px', marginTop: '12px', marginBottom: '4px' }}>
          {headingText}
        </div>
      );
      continue;
    }

    // Source/citation line
    if (line.match(/^\s*\*?\(?Source:|^\s*\(\*Source:|^\s*\*\(Source:/i)) {
      elements.push(
        <div key={i} style={{ paddingLeft: '12px', fontSize: '11px', color: '#1a73e8', marginTop: '4px', marginBottom: '8px', fontStyle: 'italic' }}>
          {formatInline(line)}
        </div>
      );
      continue;
    }

    // Bullet points (including nested: "  - " or "  * ")
    if (line.match(/^\s*[\*\-]\s/)) {
      const indentMatch = line.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1].length : 0;
      const isNested = indent >= 2;
      const bulletText = line.replace(/^\s*[\*\-]\s/, '');
      const bulletContent = formatInline(bulletText);

      // Check if the next line is an inline source citation
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      if (nextLine.match(/^\s*\*?\(?Source:|^\s*\(\*Source:|^\s*\*\(Source:/i)) {
        elements.push(
          <div key={i} style={{ paddingLeft: isNested ? '28px' : '12px', marginBottom: '8px' }}>
            <div>• {bulletContent}</div>
            <div style={{ fontSize: '11px', color: '#1a73e8', marginTop: '2px', fontStyle: 'italic' }}>
              {formatInline(nextLine)}
            </div>
          </div>
        );
        i++; // skip the source line
      } else {
        elements.push(
          <div key={i} style={{ paddingLeft: isNested ? '28px' : '12px', marginBottom: '4px' }}>
            • {bulletContent}
          </div>
        );
      }
      continue;
    }

    // Regular text
    elements.push(<div key={i} style={{ marginBottom: '2px' }}>{formatInline(line)}</div>);
  }

  return <>{elements}</>;
}
