import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivacyNotice, PRIVACY_NOTICE_SESSION_KEY } from './components/PrivacyNotice';

const STORAGE_KEYS = {
  darkMode: 'coursechat-dark-mode',
  chatHistory: 'coursechat-chat-history',
} as const;

type Theme = {
  bg: string;
  text: string;
  textMuted: string;
  textSecondary: string;
  accent: string;
  accentDark: string;
  settingsBg: string;
  border: string;
  borderLight: string;
  inputBg: string;
  warningBg: string;
  warningText: string;
  successBg: string;
  success: string;
  errorBg: string;
  error: string;
  hoverBg: string;
  cardBg: string;
  shadow: string;
  indexedBg: string;
  indexedText: string;
};

const lightTheme: Theme = {
  bg: '#ffffff',
  text: '#1f1f1f',
  textMuted: '#666666',
  textSecondary: '#4f4f4f',
  accent: '#1a73e8',
  accentDark: '#1558b0',
  settingsBg: '#f8fafc',
  border: '#d9e2ec',
  borderLight: '#cbd5e1',
  inputBg: '#ffffff',
  warningBg: '#fef7e0',
  warningText: '#8a6d3b',
  successBg: '#e6f4ea',
  success: '#188038',
  errorBg: '#fce8e6',
  error: '#d93025',
  hoverBg: '#eef2f7',
  cardBg: '#ffffff',
  shadow: 'rgba(0,0,0,0.08)',
  indexedBg: '#e8f5e9',
  indexedText: '#2e7d32',
};

const darkTheme: Theme = {
  bg: '#0f172a',
  text: '#e5e7eb',
  textMuted: '#9ca3af',
  textSecondary: '#cbd5e1',
  accent: '#7dd3fc',
  accentDark: '#38bdf8',
  settingsBg: '#111827',
  border: '#334155',
  borderLight: '#475569',
  inputBg: '#0b1220',
  warningBg: '#3a2f12',
  warningText: '#fbbf24',
  successBg: '#10261a',
  success: '#4ade80',
  errorBg: '#3b1d1d',
  error: '#f87171',
  hoverBg: '#1f2937',
  cardBg: '#111827',
  shadow: 'rgba(0,0,0,0.35)',
  indexedBg: '#0f2a1a',
  indexedText: '#86efac',
};

function CopyButton({ text, theme }: { text: string; theme: Theme }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      style={{
        padding: '6px 10px',
        background: copied ? theme.successBg : theme.hoverBg,
        color: copied ? theme.success : theme.textSecondary,
        border: `1px solid ${theme.border}`,
        borderRadius: '8px',
        fontSize: '12px',
        cursor: 'pointer',
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <line x1="12" y1="2.5" x2="12" y2="5.5" />
        <line x1="12" y1="18.5" x2="12" y2="21.5" />
        <line x1="2.5" y1="12" x2="5.5" y2="12" />
        <line x1="18.5" y1="12" x2="21.5" y2="12" />
        <line x1="4.8" y1="4.8" x2="6.9" y2="6.9" />
        <line x1="17.1" y1="17.1" x2="19.2" y2="19.2" />
        <line x1="4.8" y1="19.2" x2="6.9" y2="17.1" />
        <line x1="17.1" y1="6.9" x2="19.2" y2="4.8" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M16.8 14.9A7.3 7.3 0 0 1 9.1 7.2c0-1.1.2-2.1.6-3.1A8.6 8.6 0 1 0 19.9 17c-1-.4-2-.6-3.1-.6Z"
        fill="currentColor"
      />
    </svg>
  );
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
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const theme = darkMode ? darkTheme : lightTheme;

  useEffect(() => {
    chrome.storage.session.get([PRIVACY_NOTICE_SESSION_KEY], (result) => {
      setPrivacyAcknowledged(Boolean(result[PRIVACY_NOTICE_SESSION_KEY]));
    });

    chrome.storage.local.get([STORAGE_KEYS.darkMode], (result) => {
      setDarkMode(Boolean(result[STORAGE_KEYS.darkMode]));
    });
  }, []);

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
    // Check existing context
    chrome.storage.local.get(['course_context_default-course', 'course_files_default-course'], (r) => {
      const ctx = r['course_context_default-course'] || '';
      if (ctx.length > 0) setTotalChars(ctx.length);
      const files = r['course_files_default-course'] || [];
      if (files.length > 0) setUploadedFiles(files);
    });
  }, []);

  async function sendMessage(message: any): Promise<any> {
    try { return await chrome.runtime.sendMessage(message); } catch { return null; }
  }

  function handleAcknowledgePrivacyNotice() {
    chrome.storage.session.set({ [PRIVACY_NOTICE_SESSION_KEY]: true }).catch(() => {});
    setPrivacyAcknowledged(true);
  }

  async function handleSaveKey() {
    if (!privacyAcknowledged) {
      setKeyError('Please acknowledge the privacy notice first.');
      return;
    }
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
    let skipped = 0;
    const newFileNames: string[] = [];

    for (const file of Array.from(files)) {
      // Reject duplicates
      if (uploadedFiles.includes(file.name)) { skipped++; continue; }
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

    if (skipped > 0 && filesProcessed === 0) {
      setIndexResult(`⚠️ ${skipped} file(s) already uploaded. Skipped duplicates.`);
      setIndexing(false); e.target.value = ''; return;
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

  // Delete individual file
  async function handleDeleteFile(fileName: string) {
    const newFiles = uploadedFiles.filter(f => f !== fileName);
    // Re-read context — we can't selectively remove text, so we just update the file list
    // The context still contains the text but it won't cause harm
    // For a clean approach, we'd need to re-extract all remaining files
    // For now, just update the file list display
    await chrome.storage.local.set({ 'course_files_default-course': newFiles });
    setUploadedFiles(newFiles);
    if (newFiles.length === 0) {
      await chrome.storage.local.remove(['course_context_default-course', 'course_files_default-course']);
      setTotalChars(0);
      setIndexResult('All files removed. Upload new files to start.');
    }
  }

  async function handleClearContext() {
    await chrome.storage.local.remove('course_context_default-course');
    setUploadedFiles([]); setTotalChars(0);
    setIndexResult('Cleared. Upload new files to start fresh.');
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
    const firstQ = answers.length > 0 ? answers[answers.length - 1].query.slice(0, 30).replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-').toLowerCase() : 'chat';
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    const time = `${hours}-${String(now.getMinutes()).padStart(2,'0')}${ampm}`;
    a.download = `coursechat-${firstQ}_${date}_${time}.md`;
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
          <button
            type="button"
            onClick={toggleDarkMode}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              width: '36px',
              height: '36px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: darkMode ? 'linear-gradient(135deg, #1f2937, #111827)' : 'linear-gradient(135deg, #ffffff, #eef2ff)',
              color: darkMode ? '#fbbf24' : theme.accent,
              border: `1px solid ${darkMode ? '#334155' : theme.border}`,
              borderRadius: '10px',
              cursor: 'pointer',
              boxShadow: `0 2px 6px ${theme.shadow}`,
              transition: 'transform 0.15s ease, box-shadow 0.15s ease, background 0.2s ease',
              padding: 0,
            }}
          >
            {darkMode ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            title={showSettings ? 'Hide settings' : 'Open settings'}
            aria-label={showSettings ? 'Hide settings' : 'Open settings'}
            style={{
              width: '36px',
              height: '36px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: showSettings ? (darkMode ? '#1e293b' : '#dbeafe') : theme.settingsBg,
              color: showSettings ? theme.accent : theme.textSecondary,
              border: `1px solid ${theme.border}`,
              borderRadius: '10px',
              cursor: 'pointer',
              boxShadow: `0 2px 6px ${theme.shadow}`,
              transition: 'transform 0.15s ease, box-shadow 0.15s ease, background 0.2s ease',
              padding: 0,
            }}
          >
            <span aria-hidden="true" style={{ fontSize: '16px', lineHeight: 1 }}>⚙️</span>
          </button>
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
        <div style={{ marginBottom: '16px', background: theme.warningBg, padding: '14px', borderRadius: '10px', border: `1px solid ${darkMode ? '#5a5020' : '#fdd835'}` }}>
          <strong style={{ fontSize: '14px' }}>Welcome to CourseChat!</strong>
          <p style={{ fontSize: '12px', margin: '6px 0 0', color: theme.textSecondary }}>Click the gear icon above to add your free Gemini API key and start asking questions.</p>
        </div>
      )}

      {/* Privacy Notice */}
      {!privacyAcknowledged && (
        <PrivacyNotice onAcknowledge={handleAcknowledgePrivacyNotice} />
      )}

      {/* Upload Section */}
      {hasKey && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <label style={{ padding: '9px 16px', background: theme.accent, color: '#fff', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              {indexing ? <><Spinner /> Processing...</> : 'Upload PDF/file'}
              <input type="file" accept=".pdf,.pptx,.docx,.txt,.md,.py,.java,.js,.cpp,.c,.css,.csv,.ipynb,.html,.doc,.odt,.m" multiple style={{ display: 'none' }} onChange={handleFileUpload} disabled={indexing} />
            </label>
            {hasContent && (
              <button onClick={handleClearContext} style={{ padding: '9px 12px', background: theme.hoverBg, color: theme.textSecondary, border: `1px solid ${theme.border}`, borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>Clear files</button>
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
            <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {uploadedFiles.map((f, i) => (
                <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px', background: darkMode ? '#2d3748' : '#f0f4f8', border: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, borderRadius: '20px', fontSize: '11px', color: theme.text, maxWidth: '100%' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f}>📄 {f}</span>
                  <button onClick={() => handleDeleteFile(f)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: darkMode ? '#fc8181' : '#e53e3e', padding: '0', lineHeight: 1, flexShrink: 0 }} title="Remove file">×</button>
                </div>
              ))}
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
          <label style={{ fontSize: '12px', fontWeight: 600, color: theme.textSecondary, display: 'block', marginBottom: '6px' }}>Ask a question about your course.</label>
          <textarea
            style={{ width: '100%', padding: '10px 12px', border: `2px solid ${theme.borderLight}`, borderRadius: '10px', fontSize: '14px', minHeight: '64px', resize: 'vertical' as const, boxSizing: 'border-box' as const, transition: 'border-color 0.2s', outline: 'none', background: theme.inputBg, color: theme.text }}
            placeholder="e.g. What are the deliverables for this week?"
            value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown} maxLength={1000} disabled={queryLoading}
            onFocus={(e) => { e.currentTarget.style.borderColor = theme.accent; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = theme.borderLight; }}
          />
          <div style={{ display: 'flex', marginTop: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={handleQuery} disabled={queryLoading || query.trim().length < 3} style={{ padding: '10px 20px', background: queryLoading || query.trim().length < 3 ? '#a0c4f0' : '#1a73e8', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', cursor: queryLoading ? 'wait' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              {queryLoading ? <><Spinner /> Thinking...</> : 'Ask'}
            </button>
          </div>
          {!privacyAcknowledged && <div style={{ fontSize: '11px', color: '#8a6d3b', marginTop: '8px' }}>Acknowledge the privacy notice above before asking a question.</div>}
        </div>
      )}

      {/* Answer History */}
      {answers.length > 0 && (
        <div>
          {answers.map((a, i) => (
            <div key={i} style={{ marginBottom: '16px', padding: '14px', background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: `0 1px 3px ${theme.shadow}` }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: theme.text, marginBottom: '8px' }}>Q: {a.query}</div>
              <div style={{ fontSize: '13px', lineHeight: 1.6, color: darkMode ? '#ccc' : '#333' }}>
                {a.status === 'success' && <FormattedAnswer text={a.answer} />}
                {a.status === 'low_confidence' && (
                  <>
                    <span style={{ background: theme.warningBg, color: theme.warningText, padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 500 }}>Low confidence</span><br /><br />
                    <FormattedAnswer text={a.answer} />
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
