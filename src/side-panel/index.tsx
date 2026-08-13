import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// --- Styles ---
const styles = {
  container: { fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', padding: '16px', maxWidth: '100%', fontSize: '14px' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', borderBottom: '1px solid #e0e0e0', paddingBottom: '12px' } as React.CSSProperties,
  logo: { width: '24px', height: '24px', background: '#1a73e8', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: '12px' } as React.CSSProperties,
  title: { fontSize: '18px', fontWeight: 600, color: '#1a73e8' } as React.CSSProperties,
  section: { marginBottom: '16px' } as React.CSSProperties,
  label: { fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px', display: 'block' } as React.CSSProperties,
  input: { width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' as const } as React.CSSProperties,
  button: { padding: '8px 16px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 } as React.CSSProperties,
  buttonSecondary: { padding: '8px 16px', background: '#f1f3f4', color: '#333', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' } as React.CSSProperties,
  buttonDanger: { padding: '6px 12px', background: '#d93025', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' } as React.CSSProperties,
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 500 } as React.CSSProperties,
  answer: { background: '#f8f9fa', border: '1px solid #e8eaed', borderRadius: '8px', padding: '12px', marginTop: '8px', whiteSpace: 'pre-wrap' as const, lineHeight: 1.5 } as React.CSSProperties,
  citation: { fontSize: '12px', color: '#1a73e8', margin: '4px 0', cursor: 'pointer' } as React.CSSProperties,
  status: { fontSize: '12px', color: '#666', padding: '4px 0' } as React.CSSProperties,
  error: { color: '#d93025', fontSize: '12px', marginTop: '4px' } as React.CSSProperties,
  success: { color: '#188038', fontSize: '12px', marginTop: '4px' } as React.CSSProperties,
  queryArea: { width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', minHeight: '60px', resize: 'vertical' as const, boxSizing: 'border-box' as const } as React.CSSProperties,
  row: { display: 'flex', gap: '8px', alignItems: 'center' } as React.CSSProperties,
};

// --- Simple Markdown Renderer ---
function FormattedAnswer({ text }: { text: string }) {
  // Convert basic markdown to HTML-like rendering
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    let content: React.ReactNode = line;

    // Bold: **text**
    if (line.includes('**')) {
      const parts = line.split(/\*\*(.*?)\*\*/g);
      content = parts.map((part, j) =>
        j % 2 === 1 ? <strong key={j}>{part}</strong> : part
      );
    }

    // Bullet points: * text or - text
    if (line.match(/^\s*[\*\-]\s/)) {
      const bulletText = line.replace(/^\s*[\*\-]\s/, '');
      // Apply bold within bullet
      let bulletContent: React.ReactNode = bulletText;
      if (bulletText.includes('**')) {
        const parts = bulletText.split(/\*\*(.*?)\*\*/g);
        bulletContent = parts.map((part, j) =>
          j % 2 === 1 ? <strong key={j}>{part}</strong> : part
        );
      }
      elements.push(
        <div key={i} style={{ paddingLeft: '12px', marginBottom: '4px' }}>
          • {bulletContent}
        </div>
      );
      return;
    }

    // Empty lines = paragraph break
    if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: '8px' }} />);
      return;
    }

    // Source/citation lines (italic)
    if (line.startsWith('*Source:') || line.startsWith('(*')) {
      elements.push(
        <div key={i} style={{ fontSize: '11px', color: '#1a73e8', marginTop: '8px', fontStyle: 'italic' }}>
          {content}
        </div>
      );
      return;
    }

    elements.push(<div key={i} style={{ marginBottom: '2px' }}>{content}</div>);
  });

  return <>{elements}</>;
}

// --- App Component ---
function App() {
  const [apiKey, setApiKey] = useState('');
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [keySuccess, setKeySuccess] = useState('');
  const [keyLoading, setKeyLoading] = useState(false);

  const [query, setQuery] = useState('');
  const [queryLoading, setQueryLoading] = useState(false);
  const [answers, setAnswers] = useState<Array<{ query: string; answer: string; status: string; citations: any[] }>>([]);

  const [platform, setPlatform] = useState<string | null>(null);
  const [courseInfo, setCourseInfo] = useState<{ courseName: string; courseId: string } | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<string | null>(null);

  // Load initial state
  useEffect(() => {
    sendMessage({ type: 'GET_API_KEY_STATUS' }).then((res) => {
      if (res?.payload) {
        setHasKey(res.payload.hasKey);
        setMaskedKey(res.payload.maskedKey);
      }
    });

    sendMessage({ type: 'GET_ACTIVE_PLATFORM' }).then((res) => {
      if (res?.payload) {
        setPlatform(res.payload.platformName);
      }
    });

    sendMessage({ type: 'GET_COURSE_INFO' }).then((res) => {
      if (res?.payload) {
        setCourseInfo(res.payload);
      }
    });
  }, []);

  // Send message to service worker
  async function sendMessage(message: any): Promise<any> {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return null;
    }
  }

  // Handle API key submission
  async function handleSaveKey() {
    setKeyError('');
    setKeySuccess('');
    setKeyLoading(true);

    const res = await sendMessage({ type: 'VALIDATE_API_KEY', payload: { key: apiKey } });
    setKeyLoading(false);

    if (res?.payload?.hasKey) {
      setHasKey(true);
      setMaskedKey(res.payload.maskedKey);
      setApiKey('');
      setKeySuccess('API key saved and validated.');
      setShowSettings(false);
    } else {
      setKeyError('Invalid API key. Please check and try again.');
    }
  }

  // Handle API key removal
  async function handleRemoveKey() {
    await sendMessage({ type: 'VALIDATE_API_KEY', payload: { key: '' } });
    // Directly remove via storage
    await chrome.storage.local.remove('lms_rag_gemini_api_key');
    setHasKey(false);
    setMaskedKey(null);
    setKeySuccess('');
  }

  // Handle indexing
  async function handleIndex() {
    setIndexing(true);
    setIndexResult(null);

    const cid = courseInfo?.courseId ?? 'default-course';
    const res = await sendMessage({
      type: 'START_INDEXING',
      payload: { courseId: cid },
    });

    setIndexing(false);

    if (res?.type === 'INDEXING_COMPLETE' && res.payload.success) {
      const chars = res.payload._contextLength ? ` (${res.payload._contextLength} chars)` : '';
      setIndexResult(`✓ Indexed ${res.payload.documentsIndexed} document(s)${chars}. Ready to answer questions!`);
    } else if (res?.type === 'ERROR') {
      setIndexResult(`✗ ${res.payload.message}`);
    } else {
      setIndexResult('✗ Indexing failed. Try navigating to a course page with content.');
    }
  }

  // Handle file upload for indexing
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIndexing(true);
    setIndexResult(null);

    let allText = '';
    let filesProcessed = 0;

    for (const file of Array.from(files)) {
      try {
        if (file.name.endsWith('.pdf')) {
          // Send PDF to service worker for parsing via offscreen document
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          // Convert to base64
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode(...chunk);
          }
          const base64 = btoa(binary);
          
          const result = await sendMessage({ type: 'PARSE_PDF_UPLOAD', payload: { base64, fileName: file.name } });
          
          if (result?.payload?.text && result.payload.text.length > 0) {
            allText += `\n\n[${file.name}]\n${result.payload.text}`;
            filesProcessed++;
          } else {
            setIndexResult(`✗ PDF "${file.name}": ${result?.payload?.error || 'No text extracted'}`);
          }
        } else {
          // Text-based files — read as text
          const text = await file.text();
          if (text.trim().length > 0) {
            allText += `\n\n[${file.name}]\n${text.trim()}`;
            filesProcessed++;
          }
        }
      } catch (err) {
        console.error(`Failed to process ${file.name}:`, err);
        setIndexResult(`✗ Error processing ${file.name}: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    if (allText.length > 0) {
      await chrome.storage.local.set({ ['course_context_default-course']: allText.slice(0, 100000) });
      setIndexResult(`✓ Uploaded ${filesProcessed} file(s) (${allText.length} chars). Ready to answer questions!`);
    } else if (!indexResult) {
      setIndexResult('✗ Could not extract text from uploaded files.');
    }

    setIndexing(false);
    e.target.value = '';
  }

  // Handle query submission
  async function handleQuery() {
    if (!query.trim() || query.trim().length < 3) return;
    setQueryLoading(true);

    const res = await sendMessage({
      type: 'PROCESS_QUERY',
      payload: { courseId: courseInfo?.courseId ?? 'default-course', query: query.trim() },
    });

    setQueryLoading(false);

    if (res?.type === 'QUERY_RESPONSE') {
      setAnswers((prev) => [
        { query: query.trim(), answer: res.payload.answer, status: res.payload.status, citations: res.payload.citations },
        ...prev,
      ]);
    } else if (res?.type === 'ERROR') {
      setAnswers((prev) => [
        { query: query.trim(), answer: res.payload.message, status: 'error', citations: [] },
        ...prev,
      ]);
    }

    setQuery('');
  }

  // Handle Enter key
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleQuery();
    }
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>C</div>
        <span style={styles.title}>CourseChat</span>
        <div style={{ marginLeft: 'auto' }}>
          <button style={styles.buttonSecondary} onClick={() => setShowSettings(!showSettings)}>
            ⚙️
          </button>
        </div>
      </div>

      {/* Platform / Course Status */}
      <div style={styles.section}>
        {platform ? (
          <div style={styles.status}>
            🟢 <strong>{platform}</strong>
            {courseInfo && <> — {courseInfo.courseName}</>}
          </div>
        ) : (
          <div style={styles.status}>⚪ Navigate to a supported LMS course page to get started.</div>
        )}
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div style={{ ...styles.section, background: '#f8f9fa', padding: '12px', borderRadius: '8px' }}>
          <label style={styles.label}>Gemini API Key</label>
          {hasKey ? (
            <div>
              <div style={{ ...styles.row, marginBottom: '8px' }}>
                <span style={{ ...styles.badge, background: '#e6f4ea', color: '#188038' }}>✓ Key configured</span>
                <code style={{ fontSize: '12px', color: '#555' }}>{maskedKey}</code>
              </div>
              <button style={styles.buttonDanger} onClick={handleRemoveKey}>Remove Key</button>
            </div>
          ) : (
            <div>
              <input
                style={styles.input}
                type="password"
                placeholder="Paste your Gemini API key..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <div style={{ marginTop: '8px' }}>
                <button style={styles.button} onClick={handleSaveKey} disabled={keyLoading || !apiKey.trim()}>
                  {keyLoading ? 'Validating...' : 'Save Key'}
                </button>
              </div>
              {keyError && <div style={styles.error}>{keyError}</div>}
              {keySuccess && <div style={styles.success}>{keySuccess}</div>}
              <div style={{ fontSize: '11px', color: '#888', marginTop: '8px' }}>
                Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Onboarding: No key */}
      {!hasKey && !showSettings && (
        <div style={{ ...styles.section, background: '#fef7e0', padding: '12px', borderRadius: '8px' }}>
          <strong style={{ fontSize: '13px' }}>👋 Welcome to CourseChat!</strong>
          <p style={{ fontSize: '12px', margin: '8px 0 0', color: '#555' }}>
            To get started, click ⚙️ above and add your free Gemini API key.
          </p>
        </div>
      )}

      {/* Index Course Button */}
      {hasKey && (
        <div style={styles.section}>
          <div style={styles.row}>
            <button style={styles.button} onClick={handleIndex} disabled={indexing}>
              {indexing ? '📚 Indexing...' : '📚 Index This Page'}
            </button>
          </div>
          <div style={{ marginTop: '8px' }}>
            <label style={{ ...styles.buttonSecondary, display: 'inline-block', cursor: 'pointer' }}>
              📄 Upload PDF/File
              <input
                type="file"
                accept=".pdf,.pptx,.docx,.txt,.md,.py,.java,.js,.cpp,.c,.css,.csv,.ipynb,.html,.doc,.odt,.m"
                multiple
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
            </label>
          </div>
          <div style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>
            Tip: For PDFs, download from D2L then upload here for best results
          </div>
          {indexResult && (
            <div style={{ fontSize: '12px', marginTop: '6px', color: indexResult.startsWith('✓') ? '#188038' : '#d93025' }}>
              {indexResult}
            </div>
          )}
        </div>
      )}

      {/* Query Input */}
      {hasKey && (
        <div style={styles.section}>
          <label style={styles.label}>Ask a question about your course</label>
          <textarea
            style={styles.queryArea}
            placeholder="e.g. What is the definition of rise time?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={500}
            disabled={queryLoading}
          />
          <div style={{ ...styles.row, marginTop: '8px', justifyContent: 'space-between' }}>
            <button
              style={styles.button}
              onClick={handleQuery}
              disabled={queryLoading || query.trim().length < 3}
            >
              {queryLoading ? 'Thinking...' : 'Ask'}
            </button>
            <span style={{ fontSize: '11px', color: '#999' }}>{query.length}/500</span>
          </div>
        </div>
      )}

      {/* Answer History */}
      {answers.length > 0 && (
        <div style={styles.section}>
          {answers.map((a, i) => (
            <div key={i} style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#333' }}>Q: {a.query}</div>
              <div style={styles.answer}>
                {a.status === 'success' && <FormattedAnswer text={a.answer} />}
                {a.status === 'low_confidence' && (
                  <>
                    <span style={{ ...styles.badge, background: '#fef7e0', color: '#9a6700', marginBottom: '4px' }}>⚠️ Low confidence</span><br />
                    <FormattedAnswer text={a.answer} />
                  </>
                )}
                {a.status === 'insufficient_information' && (
                  <span style={{ color: '#666', fontStyle: 'italic' }}>
                    Couldn't find enough information in the course materials to answer this question.
                  </span>
                )}
                {a.status === 'retrieval_error' && (
                  <span style={{ color: '#d93025' }}>
                    {a.answer || 'Unable to retrieve an answer. Please try again.'}
                  </span>
                )}
                {a.status === 'error' && (
                  <span style={{ color: '#d93025' }}>{a.answer}</span>
                )}
              </div>
              {a.citations.length > 0 && (
                <div style={{ marginTop: '4px' }}>
                  {a.citations.map((c: any, j: number) => (
                    <div key={j} style={styles.citation}>
                      📄 {c.fileName} — p.{c.pageNumber} {c.sectionHeading && `(${c.sectionHeading})`}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><App /></React.StrictMode>);
