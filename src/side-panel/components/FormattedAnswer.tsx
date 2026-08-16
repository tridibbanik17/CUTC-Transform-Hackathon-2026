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
    // Process each $...$ segment — only convert if content looks like math
    processed = processed.replace(/\$([^$]+)\$/g, (match, math) => {
      // Only treat as LaTeX if it contains math-like characters
      if (/[\\^_{}]|\\[a-z]/.test(math) || /\btimes\b|\bfrac\b|\bsqrt\b/.test(math)) {
        return latexToUnicode(math);
      }
      // Otherwise it might be a dollar amount or non-math — leave as-is but remove $ delimiters
      return math;
    });
    // Also handle undelimited LaTeX commands (e.g. \times without $ wrapper)
    if (/\\(?:times|text|frac|log|sqrt|sum|geq|leq|neq|approx|infty|pi)\b/.test(processed)) {
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

export function FormattedAnswer({ text, onCitationClick }: { text: string; onCitationClick?: (citation: string) => void }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  // Regex to match inline citations like (Document: `Chapter 2.pdf`, Page 23) or (Document: 'file.pdf', Page 5)
  const inlineCitationRegex = /(\(Document:?\s*[`']?[\w\-\.\s]+\.(pdf|pptx|docx|doc|odt|html|ipynb|txt|md)[`']?,?\s*[Pp]age\s*\d+\))/gi;

  // Wraps inline citations in clickable spans
  function renderWithClickableCitations(content: React.ReactNode, key: string): React.ReactNode {
    if (!onCitationClick) return content;

    // Only process string nodes
    if (typeof content === 'string') {
      const parts = content.split(inlineCitationRegex);
      if (parts.length <= 1) return content;

      return parts.map((part, idx) => {
        // Every match group produces: [before, fullMatch, extension, after...]
        // The full citation matches on odd-ish indices — check if it looks like a citation
        if (part && part.match(/^\(Document/i)) {
          return (
            <span
              key={`${key}-cit-${idx}`}
              onClick={(e) => { e.stopPropagation(); onCitationClick(part); }}
              style={{ color: '#1a73e8', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
              title="Click to view source"
            >
              {part}
            </span>
          );
        }
        return part || null;
      }).filter(Boolean);
    }

    // If it's an array (from bold processing), process each string element
    if (Array.isArray(content)) {
      return content.map((item, idx) => {
        if (typeof item === 'string') {
          return renderWithClickableCitations(item, `${key}-${idx}`);
        }
        return item;
      });
    }

    return content;
  }

  // Helper to render a citation line — clickable if onCitationClick is provided
  function renderCitation(line: string, key: number | string, extraStyle?: React.CSSProperties) {
    const style: React.CSSProperties = {
      paddingLeft: '12px',
      fontSize: '11px',
      color: '#1a73e8',
      marginTop: '4px',
      marginBottom: '8px',
      fontStyle: 'italic',
      ...extraStyle,
      ...(onCitationClick ? { cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' as const } : {}),
    };
    return (
      <div
        key={key}
        style={style}
        onClick={onCitationClick ? () => onCitationClick(line) : undefined}
        title={onCitationClick ? 'Click to view source' : undefined}
      >
        {formatInline(line)}
      </div>
    );
  }

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
      elements.push(renderCitation(line, i));
      continue;
    }

    // Also detect inline citations like "[filename.pdf, Page 3]" or "Document: `filename.pdf`"
    if (line.match(/^\s*\*?\(?Document:|^\s*\[.*\.(pdf|pptx|docx|doc).*[Pp]age/i)) {
      elements.push(renderCitation(line, i));
      continue;
    }

    // Bullet points (including nested: "  - " or "  * ")
    if (line.match(/^\s*[\*\-]\s/)) {
      const indentMatch = line.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1].length : 0;
      const isNested = indent >= 2;
      const bulletText = line.replace(/^\s*[\*\-]\s/, '');
      const bulletContent = renderWithClickableCitations(formatInline(bulletText), `b${i}`);

      // Check if the next line is an inline source citation
      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      if (nextLine.match(/^\s*\*?\(?Source:|^\s*\(\*Source:|^\s*\*\(Source:/i)) {
        elements.push(
          <div key={i} style={{ paddingLeft: isNested ? '28px' : '12px', marginBottom: '8px' }}>
            <div>• {bulletContent}</div>
            {renderCitation(nextLine, `${i}-cite`, { paddingLeft: '0', marginTop: '2px', marginBottom: '0' })}
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

    // Regular text — but check if it contains a citation-like reference
    if (line.match(/\[.*\.(pdf|pptx|docx|doc).*[Pp]age\s*\d+\]/)) {
      // Line contains an inline citation reference like [filename.pdf, Page 3]
      const citStyle: React.CSSProperties = onCitationClick
        ? { marginBottom: '2px', cursor: 'pointer' }
        : { marginBottom: '2px' };
      elements.push(
        <div key={i} style={citStyle} onClick={onCitationClick ? () => onCitationClick(line) : undefined}>
          {formatInline(line)}
        </div>
      );
      continue;
    }

    elements.push(<div key={i} style={{ marginBottom: '2px' }}>{renderWithClickableCitations(formatInline(line), `t${i}`)}</div>);
  }

  return <>{elements}</>;
}
