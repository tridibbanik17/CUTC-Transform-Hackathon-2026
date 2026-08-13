import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// --- PDF Parser using sandboxed iframe ---
function parsePdfInIframe(buffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = chrome.runtime.getURL('pdf-parser/index.html');

    const timeout = setTimeout(() => { iframe.remove(); resolve(''); }, 30000);

    function onMessage(e: MessageEvent) {
      if (e.data.type === 'pdf-ready') {
        iframe.contentWindow?.postMessage({ type: 'parse-pdf', buffer: buffer.slice(0) }, '*');
      } else if (e.data.type === 'pdf-result') {
        clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        iframe.remove();
        resolve(e.data.text || '');
      }
    }
    window.addEventListener('message', onMessage);
    document.body.appendChild(iframe);
  });
}

// --- Markdown Renderer ---
function FormattedAnswer({ text }: { text: string }) {
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

// --- Loading Spinner ---
function Spinner() {
  return (
    <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid #e0e0e0', borderTopColor: '#1a73e8', borderRadius: '50%', animation: 'spin 0.8s linear infinite', verticalAlign: 'middle', marginRight: '8px' }} />
  );
}

// --- App ---
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
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [totalChars, setTotalChars] = useState(0);

  useEffect(() => {
    sendMessage({ type: 'GET_API_KEY_STATUS' }).then((res) => {
      if (res?.payload) { setHasKey(res.payload.hasKey); setMaskedKey(res.payload.maskedKey); }
    });
    sendMessage({ type: 'GET_ACTIVE_PLATFORM' }).then((res) => {
      if (res?.payload) setPlatform(res.payload.platformName);
    });
    sendMessage({ type: 'GET_COURSE_INFO' }).then((res) => {
      if (res?.payload) setCourseInfo(res.payload);
    });
    // Check existing context
    chrome.storage.local.get('course_context_default-course', (r) => {
      const ctx = r['course_context_default-course'] || '';
      if (ctx.length > 0) setTotalChars(ctx.length);
    });
  }, []);

  async function sendMessage(message: any): Promise<any> {
    try { return await chrome.runtime.sendMessage(message); } catch { return null; }
  }

  async function handleSaveKey() {
    setKeyError(''); setKeySuccess(''); setKeyLoading(true);
    const res = await sendMessage({ type: 'VALIDATE_API_KEY', payload: { key: apiKey } });
    setKeyLoading(false);
    if (res?.payload?.hasKey) {
      setHasKey(true); setMaskedKey(res.payload.maskedKey); setApiKey('');
      setKeySuccess('API key saved and validated.'); setShowSettings(false);
    } else { setKeyError('Invalid API key. Please check and try again.'); }
  }

  async function handleRemoveKey() {
    await chrome.storage.local.remove('lms_rag_gemini_api_key');
    setHasKey(false); setMaskedKey(null); setKeySuccess('');
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIndexing(true); setIndexResult(null);
    let allText = '';
    let filesProcessed = 0;
    const newFileNames: string[] = [];

    for (const file of Array.from(files)) {
      try {
        if (file.name.endsWith('.pdf')) {
          const buffer = await file.arrayBuffer();
          const text = await parsePdfInIframe(buffer);
          if (text.length > 0) { allText += `\n\n[${file.name}]\n${text}`; filesProcessed++; newFileNames.push(file.name); }
          else { setIndexResult(`✗ PDF "${file.name}" could not be parsed.`); }
        } else {
          const text = await file.text();
          if (text.trim().length > 0) { allText += `\n\n[${file.name}]\n${text.trim()}`; filesProcessed++; newFileNames.push(file.name); }
        }
      } catch (err) { console.error(`Failed: ${file.name}`, err); }
    }

    if (allText.length > 0) {
      const capped = allText.slice(0, 80000);
      await chrome.storage.local.set({ ['course_context_default-course']: capped });
      setTotalChars(capped.length);
      setUploadedFiles((prev) => [...prev, ...newFileNames]);
      setIndexResult(`✓ Uploaded ${filesProcessed} file(s). Ready to answer questions!`);
    } else if (!indexResult) { setIndexResult('✗ Could not extract text from uploaded files.'); }
    setIndexing(false); e.target.value = '';
  }

  async function handleClearContext() {
    await chrome.storage.local.remove('course_context_default-course');
    setUploadedFiles([]); setTotalChars(0);
    setIndexResult('🗑️ Cleared. Upload new files to start fresh.');
  }

  async function handleQuery() {
    if (!query.trim() || query.trim().length < 3) return;
    setQueryLoading(true);
    const res = await sendMessage({ type: 'PROCESS_QUERY', payload: { courseId: courseInfo?.courseId ?? 'default-course', query: query.trim() } });
    setQueryLoading(false);
    if (res?.type === 'QUERY_RESPONSE') {
      setAnswers((prev) => [{ query: query.trim(), answer: res.payload.answer, status: res.payload.status, citations: res.payload.citations }, ...prev]);
    } else if (res?.type === 'ERROR') {
      setAnswers((prev) => [{ query: query.trim(), answer: res.payload.message, status: 'error', citations: [] }, ...prev]);
    }
    setQuery('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuery(); }
  }

  const hasContent = totalChars > 0 || uploadedFiles.length > 0;

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '16px', fontSize: '14px', color: '#1f1f1f' }}>
      {/* Spinner animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', paddingBottom: '12px', borderBottom: '2px solid #1a73e8' }}>
        <div style={{ width: '28px', height: '28px', background: 'linear-gradient(135deg, #1a73e8, #0d47a1)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: '14px' }}>C</div>
        <span style={{ fontSize: '20px', fontWeight: 700, color: '#1a73e8' }}>CourseChat</span>
        <button onClick={() => setShowSettings(!showSettings)} style={{ marginLeft: 'auto', background: showSettings ? '#e8f0fe' : '#f8f9fa', border: '1px solid #ddd', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '14px' }}>⚙️</button>
      </div>

      {/* Platform Status — only show if no content uploaded */}
      {!hasContent && (
        <div style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
          {platform ? (
            <span>🟢 <strong>{platform}</strong>{courseInfo && <> — {courseInfo.courseName}</>}</span>
          ) : (
            <span>Upload your course PDFs below to get started.</span>
          )}
        </div>
      )}

      {/* Settings Panel — hidden by default */}
      {showSettings && (
        <div style={{ marginBottom: '16px', background: '#f8f9fa', padding: '14px', borderRadius: '10px', border: '1px solid #e8eaed' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#444', display: 'block', marginBottom: '6px' }}>Gemini API Key</label>
          {hasKey ? (
            <div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ background: '#e6f4ea', color: '#188038', padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>✓ Active</span>
                <code style={{ fontSize: '11px', color: '#666' }}>{maskedKey}</code>
              </div>
              <button onClick={handleRemoveKey} style={{ padding: '6px 12px', background: '#fce8e6', color: '#d93025', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Remove Key</button>
            </div>
          ) : (
            <div>
              <input style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' as const }} type="password" placeholder="Paste your Gemini API key..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <div style={{ marginTop: '8px' }}>
                <button onClick={handleSaveKey} disabled={keyLoading || !apiKey.trim()} style={{ padding: '8px 16px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', opacity: keyLoading || !apiKey.trim() ? 0.5 : 1 }}>
                  {keyLoading ? <><Spinner /> Validating...</> : 'Save Key'}
                </button>
              </div>
              {keyError && <div style={{ color: '#d93025', fontSize: '12px', marginTop: '6px' }}>{keyError}</div>}
              {keySuccess && <div style={{ color: '#188038', fontSize: '12px', marginTop: '6px' }}>{keySuccess}</div>}
              <div style={{ fontSize: '11px', color: '#888', marginTop: '8px' }}>Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style={{ color: '#1a73e8' }}>Google AI Studio</a></div>
            </div>
          )}
        </div>
      )}

      {/* Onboarding */}
      {!hasKey && !showSettings && (
        <div style={{ marginBottom: '16px', background: '#fef7e0', padding: '14px', borderRadius: '10px', border: '1px solid #fdd835' }}>
          <strong style={{ fontSize: '14px' }}>👋 Welcome to CourseChat!</strong>
          <p style={{ fontSize: '12px', margin: '6px 0 0', color: '#555' }}>Click ⚙️ above to add your free Gemini API key and start asking questions.</p>
        </div>
      )}

      {/* Upload Section */}
      {hasKey && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <label style={{ padding: '9px 16px', background: '#1a73e8', color: '#fff', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              {indexing ? <><Spinner /> Processing...</> : '📄 Upload PDF/File'}
              <input type="file" accept=".pdf,.pptx,.docx,.txt,.md,.py,.java,.js,.cpp,.c,.css,.csv,.ipynb,.html,.doc,.odt,.m" multiple style={{ display: 'none' }} onChange={handleFileUpload} disabled={indexing} />
            </label>
            {hasContent && (
              <button onClick={handleClearContext} style={{ padding: '9px 12px', background: '#f1f3f4', color: '#555', border: '1px solid #ddd', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>🗑️ Clear</button>
            )}
          </div>

          {/* Files indexed counter */}
          {hasContent && (
            <div style={{ marginTop: '8px', padding: '8px 12px', background: '#e8f5e9', borderRadius: '8px', fontSize: '12px', color: '#2e7d32' }}>
              📚 {uploadedFiles.length > 0 ? `${uploadedFiles.length} file${uploadedFiles.length !== 1 ? 's' : ''}` : 'Content ready'} | {(totalChars / 1000).toFixed(1)}k chars indexed
            </div>
          )}

          {/* Uploaded file names */}
          {uploadedFiles.length > 0 && (
            <div style={{ marginTop: '6px', fontSize: '11px', color: '#666' }}>
              {uploadedFiles.map((f, i) => <div key={i}>📎 {f}</div>)}
            </div>
          )}

          {indexResult && (
            <div style={{ fontSize: '12px', marginTop: '8px', color: indexResult.startsWith('✓') ? '#188038' : indexResult.startsWith('🗑️') ? '#666' : '#d93025' }}>
              {indexResult}
            </div>
          )}
        </div>
      )}

      {/* Query Input */}
      {hasKey && (
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#444', display: 'block', marginBottom: '6px' }}>Ask a question about your course</label>
          <textarea
            style={{ width: '100%', padding: '10px 12px', border: '2px solid #e0e0e0', borderRadius: '10px', fontSize: '14px', minHeight: '64px', resize: 'vertical' as const, boxSizing: 'border-box' as const, transition: 'border-color 0.2s', outline: 'none' }}
            placeholder="e.g. What are the deliverables for this week?"
            value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown} maxLength={1000} disabled={queryLoading}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#1a73e8'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = '#e0e0e0'; }}
          />
          <div style={{ display: 'flex', marginTop: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={handleQuery} disabled={queryLoading || query.trim().length < 3} style={{ padding: '10px 20px', background: queryLoading || query.trim().length < 3 ? '#a0c4f0' : '#1a73e8', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', cursor: queryLoading ? 'wait' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              {queryLoading ? <><Spinner /> Thinking...</> : 'Ask'}
            </button>
            <span style={{ fontSize: '11px', color: '#999' }}>{query.length}/1000</span>
          </div>
        </div>
      )}

      {/* Answer History */}
      {answers.length > 0 && (
        <div>
          {answers.map((a, i) => (
            <div key={i} style={{ marginBottom: '16px', padding: '14px', background: '#fff', border: '1px solid #e8eaed', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1f1f1f', marginBottom: '8px' }}>Q: {a.query}</div>
              <div style={{ fontSize: '13px', lineHeight: 1.6, color: '#333' }}>
                {a.status === 'success' && <FormattedAnswer text={a.answer} />}
                {a.status === 'low_confidence' && (
                  <>
                    <span style={{ background: '#fef7e0', color: '#9a6700', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 500 }}>⚠️ Low confidence</span><br /><br />
                    <FormattedAnswer text={a.answer} />
                  </>
                )}
                {a.status === 'insufficient_information' && (
                  <span style={{ color: '#666', fontStyle: 'italic' }}>Couldn't find enough information in the course materials to answer this question.</span>
                )}
                {a.status === 'retrieval_error' && <span style={{ color: '#d93025' }}>{a.answer || 'Unable to retrieve an answer. Please try again.'}</span>}
                {a.status === 'error' && <span style={{ color: '#d93025' }}>{a.answer}</span>}
              </div>
              {a.citations.length > 0 && (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #f0f0f0' }}>
                  {a.citations.map((c: any, j: number) => (
                    <div key={j} style={{ fontSize: '11px', color: '#1a73e8', margin: '3px 0' }}>📄 {c.fileName} — p.{c.pageNumber} {c.sectionHeading && `(${c.sectionHeading})`}</div>
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
