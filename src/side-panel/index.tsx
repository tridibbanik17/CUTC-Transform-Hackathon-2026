import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// --- Types ---
interface AnswerEntry {
  query: string;
  answer: string;
  status: string;
  citations: Array<{ fileName: string; pageNumber: number; sectionHeading: string }>;
}

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

// --- Theme definitions ---
const themes = {
  light: {
    bg: '#ffffff',
    text: '#1f1f1f',
    textSecondary: '#555',
    textMuted: '#666',
    textFaint: '#888',
    border: '#e8eaed',
    borderLight: '#e0e0e0',
    inputBg: '#ffffff',
    cardBg: '#ffffff',
    settingsBg: '#f8f9fa',
    accent: '#1a73e8',
    accentDark: '#0d47a1',
    success: '#188038',
    successBg: '#e6f4ea',
    error: '#d93025',
    errorBg: '#fce8e6',
    warningBg: '#fef7e0',
    warningText: '#9a6700',
    indexedBg: '#e8f5e9',
    indexedText: '#2e7d32',
    shadow: 'rgba(0,0,0,0.06)',
    hoverBg: '#f1f3f4',
    copySuccess: '#188038',
  },
  dark: {
    bg: '#1e1e1e',
    text: '#e0e0e0',
    textSecondary: '#b0b0b0',
    textMuted: '#999',
    textFaint: '#777',
    border: '#333',
    borderLight: '#444',
    inputBg: '#2a2a2a',
    cardBg: '#252525',
    settingsBg: '#2a2a2a',
    accent: '#8ab4f8',
    accentDark: '#4a90d9',
    success: '#81c995',
    successBg: '#1b3a2a',
    error: '#f28b82',
    errorBg: '#3a2020',
    warningBg: '#3a3520',
    warningText: '#fdd835',
    indexedBg: '#1b3a2a',
    indexedText: '#81c995',
    shadow: 'rgba(0,0,0,0.3)',
    hoverBg: '#333',
    copySuccess: '#81c995',
  },
};

type Theme = typeof themes.light;

// --- Markdown Renderer ---
function FormattedAnswer({ text, theme }: { text: string; theme: Theme }) {
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
      elements.push(<div key={i} style={{ fontSize: '11px', color: theme.accent, marginTop: '8px', fontStyle: 'italic' }}>{content}</div>);
      return;
    }
    elements.push(<div key={i} style={{ marginBottom: '2px' }}>{content}</div>);
  });
  return <>{elements}</>;
}

// --- Loading Spinner ---
function Spinner({ theme }: { theme: Theme }) {
  return (
    <span style={{ display: 'inline-block', width: '16px', height: '16px', border: `2px solid ${theme.borderLight}`, borderTopColor: theme.accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite', verticalAlign: 'middle', marginRight: '8px' }} />
  );
}

// --- Copy Button ---
function CopyButton({ text, theme }: { text: string; theme: Theme }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    // Strip markdown formatting for plain text paste
    const plain = text
      .replace(/\*\*(.*?)\*\*/g, '$1')  // **bold** → bold
      .replace(/\*(.*?)\*/g, '$1')      // *italic* → italic
      .replace(/^#{1,3}\s*/gm, '')      // ### heading → heading
      .replace(/^[\*\-]\s/gm, '• ')     // * bullet → • bullet
      .replace(/`(.*?)`/g, '$1');        // `code` → code
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = plain;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy answer'}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: '14px',
        padding: '4px 8px',
        borderRadius: '6px',
        color: copied ? theme.copySuccess : theme.textMuted,
        transition: 'color 0.2s',
      }}
    >
      {copied ? '✓ Copied' : '📋 Copy'}
    </button>
  );
}

// --- Storage Keys ---
const STORAGE_KEYS = {
  chatHistory: 'coursechat_history',
  darkMode: 'coursechat_dark_mode',
};

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
  const [answers, setAnswers] = useState<AnswerEntry[]>([]);
  const [platform, setPlatform] = useState<string | null>(null);
  const [courseInfo, setCourseInfo] = useState<{ courseName: string; courseId: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [totalChars, setTotalChars] = useState(0);
  const [darkMode, setDarkMode] = useState(false);

  const theme = darkMode ? themes.dark : themes.light;

  // Load persisted state on mount
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
    // Load chat history and dark mode preference
    chrome.storage.local.get([
      'course_context_default-course',
      'course_files_default-course',
      STORAGE_KEYS.chatHistory,
      STORAGE_KEYS.darkMode,
    ], (r) => {
      const ctx = r['course_context_default-course'] || '';
      if (ctx.length > 0) setTotalChars(ctx.length);
      const files = r['course_files_default-course'] || [];
      if (files.length > 0) setUploadedFiles(files);
      // Restore chat history
      const savedHistory = r[STORAGE_KEYS.chatHistory];
      if (savedHistory && Array.isArray(savedHistory)) {
        setAnswers(savedHistory);
      }
      // Restore dark mode
      if (r[STORAGE_KEYS.darkMode] !== undefined) {
        setDarkMode(r[STORAGE_KEYS.darkMode]);
      }
    });
  }, []);

  // Persist chat history whenever answers change
  const persistHistory = useCallback((history: AnswerEntry[]) => {
    chrome.storage.local.set({ [STORAGE_KEYS.chatHistory]: history });
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
      const allFileNames = [...uploadedFiles, ...newFileNames];
      await chrome.storage.local.set({
        'course_context_default-course': capped,
        'course_files_default-course': allFileNames,
      });
      setTotalChars(capped.length);
      setUploadedFiles(allFileNames);
      setIndexResult(`✓ Uploaded ${filesProcessed} file(s). Ready to answer questions!`);
    } else if (!indexResult) { setIndexResult('✗ Could not extract text from uploaded files.'); }
    setIndexing(false); e.target.value = '';
  }

  async function handleClearContext() {
    await chrome.storage.local.remove(['course_context_default-course', 'course_files_default-course']);
    setUploadedFiles([]); setTotalChars(0);
    setIndexResult('Cleared. Upload new files to start fresh.');
  }

  async function handleQuery() {
    if (!query.trim() || query.trim().length < 1) return;
    setQueryLoading(true);
    const res = await sendMessage({ type: 'PROCESS_QUERY', payload: { courseId: courseInfo?.courseId ?? 'default-course', query: query.trim() } });
    setQueryLoading(false);
    const newEntry: AnswerEntry = res?.type === 'QUERY_RESPONSE'
      ? { query: query.trim(), answer: res.payload.answer, status: res.payload.status, citations: res.payload.citations }
      : { query: query.trim(), answer: res?.payload?.message || 'Unknown error', status: 'error', citations: [] };
    const updated = [newEntry, ...answers];
    setAnswers(updated);
    persistHistory(updated);
    setQuery('');
  }

  function handleClearHistory() {
    setAnswers([]);
    chrome.storage.local.remove(STORAGE_KEYS.chatHistory);
  }

  function handleExportChat() {
    if (answers.length === 0) return;
    const lines: string[] = ['# CourseChat - Conversation Export', '', `Exported: ${new Date().toLocaleString()}`, ''];
    // Reverse to show oldest first
    [...answers].reverse().forEach((a, i) => {
      lines.push(`## Q${i + 1}: ${a.query}`);
      lines.push('');
      lines.push(a.answer);
      if (a.citations.length > 0) {
        lines.push('');
        lines.push('**Sources:**');
        a.citations.forEach((c) => {
          lines.push(`- ${c.fileName} — p.${c.pageNumber}${c.sectionHeading ? ` (${c.sectionHeading})` : ''}`);
        });
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    });
    const markdown = lines.join('\n');
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coursechat-export-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function toggleDarkMode() {
    const newMode = !darkMode;
    setDarkMode(newMode);
    chrome.storage.local.set({ [STORAGE_KEYS.darkMode]: newMode });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuery(); }
  }

  const hasContent = totalChars > 0 || uploadedFiles.length > 0;

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '16px', fontSize: '14px', color: theme.text, background: theme.bg, minHeight: '100vh', transition: 'background 0.3s, color 0.3s' }}>
      {/* Animations */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        body { margin: 0; background: ${theme.bg}; }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', paddingBottom: '12px', borderBottom: `2px solid ${theme.accent}` }}>
        <div style={{ width: '28px', height: '28px', background: `linear-gradient(135deg, ${theme.accent}, ${theme.accentDark})`, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: '14px' }}>C</div>
        <span style={{ fontSize: '20px', fontWeight: 700, color: theme.accent }}>CourseChat</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          <button onClick={toggleDarkMode} title={darkMode ? 'Light mode' : 'Dark mode'} style={{ background: theme.settingsBg, border: `1px solid ${theme.border}`, borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '14px' }}>
            {darkMode ? '☀️' : '🌙'}
          </button>
          <button onClick={() => setShowSettings(!showSettings)} style={{ background: showSettings ? (darkMode ? '#2a3a5a' : '#e8f0fe') : theme.settingsBg, border: `1px solid ${theme.border}`, borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '14px' }}>⚙️</button>
        </div>
      </div>

      {/* Platform Status — only show if no content uploaded */}
      {!hasContent && (
        <div style={{ fontSize: '12px', color: theme.textMuted, marginBottom: '12px' }}>
          {platform ? (
            <span>🟢 <strong>{platform}</strong>{courseInfo && <> — {courseInfo.courseName}</>}</span>
          ) : (
            <span>Upload your course PDFs below to get started.</span>
          )}
        </div>
      )}

      {/* Settings Panel — hidden by default */}
      {showSettings && (
        <div style={{ marginBottom: '16px', background: theme.settingsBg, padding: '14px', borderRadius: '10px', border: `1px solid ${theme.border}` }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: theme.textSecondary, display: 'block', marginBottom: '6px' }}>Gemini API Key</label>
          {hasKey ? (
            <div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ background: theme.successBg, color: theme.success, padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>✓ Active</span>
                <code style={{ fontSize: '11px', color: theme.textMuted }}>{maskedKey}</code>
              </div>
              <button onClick={handleRemoveKey} style={{ padding: '6px 12px', background: theme.errorBg, color: theme.error, border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Remove Key</button>
            </div>
          ) : (
            <div>
              <input style={{ width: '100%', padding: '9px 12px', border: `1px solid ${theme.borderLight}`, borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' as const, background: theme.inputBg, color: theme.text }} type="password" placeholder="Paste your Gemini API key..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <div style={{ marginTop: '8px' }}>
                <button onClick={handleSaveKey} disabled={keyLoading || !apiKey.trim()} style={{ padding: '8px 16px', background: theme.accent, color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', opacity: keyLoading || !apiKey.trim() ? 0.5 : 1 }}>
                  {keyLoading ? <><Spinner theme={theme} /> Validating...</> : 'Save Key'}
                </button>
              </div>
              {keyError && <div style={{ color: theme.error, fontSize: '12px', marginTop: '6px' }}>{keyError}</div>}
              {keySuccess && <div style={{ color: theme.success, fontSize: '12px', marginTop: '6px' }}>{keySuccess}</div>}
              <div style={{ fontSize: '11px', color: theme.textFaint, marginTop: '8px' }}>Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style={{ color: theme.accent }}>Google AI Studio</a></div>
            </div>
          )}
        </div>
      )}

      {/* Onboarding */}
      {!hasKey && !showSettings && (
        <div style={{ marginBottom: '16px', background: theme.warningBg, padding: '14px', borderRadius: '10px', border: `1px solid ${darkMode ? '#5a5020' : '#fdd835'}` }}>
          <strong style={{ fontSize: '14px' }}>Welcome to CourseChat!</strong>
          <p style={{ fontSize: '12px', margin: '6px 0 0', color: theme.textSecondary }}>Click the gear icon above to add your free Gemini API key and start asking questions.</p>
        </div>
      )}

      {/* Upload Section */}
      {hasKey && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <label style={{ padding: '9px 16px', background: theme.accent, color: '#fff', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              {indexing ? <><Spinner theme={theme} /> Processing...</> : 'Upload PDF/File'}
              <input type="file" accept=".pdf,.pptx,.docx,.txt,.md,.py,.java,.js,.cpp,.c,.css,.csv,.ipynb,.html,.doc,.odt,.m" multiple style={{ display: 'none' }} onChange={handleFileUpload} disabled={indexing} />
            </label>
            {hasContent && (
              <button onClick={handleClearContext} style={{ padding: '9px 12px', background: theme.hoverBg, color: theme.textSecondary, border: `1px solid ${theme.border}`, borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>Clear Files</button>
            )}
          </div>

          {/* Files indexed counter */}
          {hasContent && (
            <div style={{ marginTop: '8px', padding: '8px 12px', background: theme.indexedBg, borderRadius: '8px', fontSize: '12px', color: theme.indexedText }}>
              {uploadedFiles.length > 0 ? `${uploadedFiles.length} file${uploadedFiles.length !== 1 ? 's' : ''}` : 'Content ready'} | {(totalChars / 1000).toFixed(1)}k chars indexed
            </div>
          )}

          {/* Uploaded file names */}
          {uploadedFiles.length > 0 && (
            <div style={{ marginTop: '6px', fontSize: '11px', color: theme.textMuted }}>
              {uploadedFiles.map((f, i) => <div key={i}>📎 {f}</div>)}
            </div>
          )}

          {indexResult && (
            <div style={{ fontSize: '12px', marginTop: '8px', color: indexResult.startsWith('✓') ? theme.success : indexResult.startsWith('Cleared') ? theme.textMuted : theme.error }}>
              {indexResult}
            </div>
          )}
        </div>
      )}

      {/* Query Input */}
      {hasKey && (
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: theme.textSecondary, display: 'block', marginBottom: '6px' }}>Ask a question about your course</label>
          <textarea
            style={{ width: '100%', padding: '10px 12px', border: `2px solid ${theme.borderLight}`, borderRadius: '10px', fontSize: '14px', minHeight: '64px', resize: 'vertical' as const, boxSizing: 'border-box' as const, transition: 'border-color 0.2s', outline: 'none', background: theme.inputBg, color: theme.text }}
            placeholder="e.g. What are the deliverables for this week?"
            value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown} maxLength={1000} disabled={queryLoading}
            onFocus={(e) => { e.currentTarget.style.borderColor = theme.accent; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = theme.borderLight; }}
          />
          <div style={{ display: 'flex', marginTop: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={handleQuery} disabled={queryLoading || query.trim().length < 1} style={{ padding: '10px 20px', background: queryLoading || query.trim().length < 1 ? (darkMode ? '#3a5070' : '#a0c4f0') : theme.accent, color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', cursor: queryLoading ? 'wait' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              {queryLoading ? <><Spinner theme={theme} /> Thinking...</> : 'Ask'}
            </button>
            <span style={{ fontSize: '11px', color: theme.textFaint }}>{query.length}/1000</span>
          </div>
        </div>
      )}

      {/* Answer History Header with Export & Clear */}
      {answers.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: theme.textSecondary }}>{answers.length} answer{answers.length !== 1 ? 's' : ''}</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={handleExportChat} title="Export as Markdown" style={{ background: 'none', border: `1px solid ${theme.border}`, borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', color: theme.textSecondary }}>
              Export
            </button>
            <button onClick={handleClearHistory} title="Clear chat history" style={{ background: 'none', border: `1px solid ${theme.border}`, borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px', color: theme.textSecondary }}>
              Clear Chat
            </button>
          </div>
        </div>
      )}

      {/* Answer History */}
      {answers.length > 0 && (
        <div>
          {answers.map((a, i) => (
            <div key={i} style={{ marginBottom: '16px', padding: '14px', background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: `0 1px 3px ${theme.shadow}` }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: theme.text, marginBottom: '8px' }}>Q: {a.query}</div>
              <div style={{ fontSize: '13px', lineHeight: 1.6, color: darkMode ? '#ccc' : '#333' }}>
                {a.status === 'success' && <FormattedAnswer text={a.answer} theme={theme} />}
                {a.status === 'low_confidence' && (
                  <>
                    <span style={{ background: theme.warningBg, color: theme.warningText, padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 500 }}>Low confidence</span><br /><br />
                    <FormattedAnswer text={a.answer} theme={theme} />
                  </>
                )}
                {a.status === 'insufficient_information' && (
                  <span style={{ color: theme.textMuted, fontStyle: 'italic' }}>Couldn't find enough information in the course materials to answer this question.</span>
                )}
                {a.status === 'retrieval_error' && <span style={{ color: theme.error }}>{a.answer || 'Unable to retrieve an answer. Please try again.'}</span>}
                {a.status === 'error' && <span style={{ color: theme.error }}>{a.answer}</span>}
              </div>
              {a.citations.length > 0 && (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${theme.border}` }}>
                  {a.citations.map((c, j) => (
                    <div key={j} style={{ fontSize: '11px', color: theme.accent, margin: '3px 0' }}>{c.fileName} — p.{c.pageNumber} {c.sectionHeading && `(${c.sectionHeading})`}</div>
                  ))}
                </div>
              )}
              {/* Copy button */}
              <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'flex-end' }}>
                <CopyButton text={a.answer} theme={theme} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><App /></React.StrictMode>);
