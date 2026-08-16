import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { extractPptxText, extractDocxText, extractDocText, extractOdtText } from '@/shared/binary-extractors';
import { FormattedAnswer } from './components/FormattedAnswer';

const CHAT_HISTORY_KEY = 'coursechat-chat-history';

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

// --- Speak Button (toggle: start/stop) ---
function SpeakButton({ text, theme }: { text: string; theme: Theme }) {
  const [speaking, setSpeaking] = useState(false);

  const handleClick = () => {
    if (!('speechSynthesis' in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    } else {
      window.speechSynthesis.cancel();
      const plain = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^\* /gm, '').replace(/^\- /gm, '');
      const utterance = new SpeechSynthesisUtterance(plain);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
      setSpeaking(true);
    }
  };

  return (
    <button onClick={handleClick} style={{ background: speaking ? '#d93025' : 'none', color: speaking ? '#fff' : theme.textMuted, border: `1px solid ${speaking ? '#d93025' : theme.border}`, borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', transition: 'all 0.2s' }} title={speaking ? 'Stop reading' : 'Read aloud'}>
      {speaking ? '⏹ Stop' : '🔊 Listen'}
    </button>
  );
}

function CopyButton({ text, theme }: { text: string; theme: Theme }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    // Convert markdown to HTML for rich paste (Word/Docs), keep plain text as fallback
    const html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/^\* /gm, '• ')
      .replace(/^\- /gm, '• ')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^• (.*)$/gm, '<li>$1</li>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
    
    const plain = text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/^\* /gm, '• ')
      .replace(/^\- /gm, '• ')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1');

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: plain text only
      try { await navigator.clipboard.writeText(plain); } catch {}
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
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

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M19.4 13.5c.1-.5.1-1 0-1.5l1.7-1.3-1.7-3-2 .7c-.4-.4-.8-.7-1.3-1l-.3-2.1h-3.4l-.3 2.1c-.5.2-.9.6-1.3 1l-2-.7-1.7 3 1.7 1.3c-.1.5-.1 1 0 1.5L5.8 14.8l1.7 3 2-.7c.4.4.8.7 1.3 1l.3 2.1h3.4l.3-2.1c.5-.2.9-.6 1.3-1l2 .7 1.7-3-1.7-1.3ZM12 15.3A3.3 3.3 0 1 1 12 8.7a3.3 3.3 0 0 1 0 6.6Z"
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

    // Scale timeout by file size: 30s base + 1s per MB
    const sizeMB = buffer.byteLength / (1024 * 1024);
    const timeoutMs = Math.max(30000, 30000 + sizeMB * 1000);
    const timeout = setTimeout(() => { iframe.remove(); resolve(''); }, timeoutMs);

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
  const [previewFile, setPreviewFile] = useState<{ name: string; text: string; scrollToPage?: number } | null>(null);

  // Persist chat history to chrome.storage.local
  function persistHistory(history: typeof answers) {
    chrome.storage.local.set({ [CHAT_HISTORY_KEY]: history });
  }

  // Load persisted chat history on mount
  useEffect(() => {
    chrome.storage.local.get(CHAT_HISTORY_KEY, (r) => {
      const saved = r[CHAT_HISTORY_KEY];
      if (Array.isArray(saved) && saved.length > 0) {
        setAnswers(saved);
      }
    });
  }, []);
  const [platform, setPlatform] = useState<string | null>(null);
  const [courseInfo, setCourseInfo] = useState<{ courseName: string; courseId: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; currentFile: string } | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [totalChars, setTotalChars] = useState(0);
  const [darkMode, setDarkMode] = useState(false);
  const [showTips, setShowTips] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const theme = darkMode ? darkTheme : lightTheme;

  useEffect(() => {
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
    setIndexing(true); setIndexResult(null); setFileErrors([]);
    let filesProcessed = 0;
    let skipped = 0;
    const newFileNames: string[] = [];
    const fileArray = Array.from(files);
    const totalFiles = fileArray.length;

    for (let idx = 0; idx < fileArray.length; idx++) {
      const file = fileArray[idx];
      if (uploadedFiles.includes(file.name)) { skipped++; continue; }

      // Validate file extension — reject unsupported formats
      const supportedExtensions = ['.pdf', '.pptx', '.docx', '.doc', '.odt', '.html', '.ipynb', '.txt', '.md', '.py', '.java', '.js', '.cpp', '.c', '.css', '.csv', '.m', '.tex'];
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!supportedExtensions.includes(ext)) {
        setFileErrors(prev => [...prev, `"${file.name}" is not a supported file type.`]);
        continue;
      }

      setUploadProgress({ current: idx + 1, total: totalFiles, currentFile: file.name });
      try {
        let text = '';
        if (file.name.endsWith('.pdf')) {
          const buffer = await file.arrayBuffer();
          text = await parsePdfInIframe(buffer);
        } else if (file.name.endsWith('.pptx')) {
          const buffer = await file.arrayBuffer();
          text = await extractPptxText(buffer);
        } else if (file.name.endsWith('.docx')) {
          const buffer = await file.arrayBuffer();
          text = await extractDocxText(buffer);
        } else if (file.name.endsWith('.doc')) {
          const buffer = await file.arrayBuffer();
          text = extractDocText(buffer);
        } else if (file.name.endsWith('.odt')) {
          const buffer = await file.arrayBuffer();
          text = await extractOdtText(buffer);
        } else {
          text = (await file.text()).trim();
        }
        if (text.length > 0) {
          // Store file text locally — with unlimitedStorage permission this
          // should always succeed, but handle errors gracefully just in case.
          try {
            await chrome.storage.local.set({ [`file_text_${file.name}`]: text });
          } catch (storageErr) {
            console.warn(`Storage error for ${file.name}:`, storageErr);
          }
          filesProcessed++;
          newFileNames.push(file.name);
          // Index into Backboard.io. Chrome message passing has a practical
          // size limit (~50MB) and the service worker can get killed with very
          // large payloads. Send in chunks if the text is large.
          const MAX_CHUNK_SIZE = 500_000; // 500k chars per message — safe for SW
          const courseId = courseInfo?.courseId ?? 'default-course';
          if (text.length <= MAX_CHUNK_SIZE) {
            sendMessage({
              type: 'INDEX_EXTRACTED_TEXT',
              payload: { courseId, fileName: file.name, text },
            }).catch(() => {});
          } else {
            // Split into chunks and send sequentially to avoid crashing SW
            for (let start = 0; start < text.length; start += MAX_CHUNK_SIZE) {
              const chunk = text.slice(start, start + MAX_CHUNK_SIZE);
              const chunkName = start === 0 ? file.name : `${file.name} (part ${Math.floor(start / MAX_CHUNK_SIZE) + 1})`;
              sendMessage({
                type: 'INDEX_EXTRACTED_TEXT',
                payload: { courseId, fileName: chunkName, text: chunk },
              }).catch(() => {});
            }
          }
        } else {
          setFileErrors(prev => [...prev, `"${file.name}" could not be parsed.`]);
        }
      } catch (err) {
        console.error(`Failed: ${file.name}`, err);
        setFileErrors(prev => [...prev, `"${file.name}" failed: ${err instanceof Error ? err.message : 'Unknown error'}`]);
      }
    }

    setUploadProgress(null);
    if (skipped > 0 && filesProcessed === 0) {
      setIndexResult(`⚠️ ${skipped} file(s) already uploaded. Skipped duplicates.`);
      setIndexing(false); e.target.value = ''; return;
    }

    if (filesProcessed > 0) {
      const allFileNames = [...uploadedFiles, ...newFileNames];
      await chrome.storage.local.set({ 'course_files_default-course': allFileNames });
      setUploadedFiles(allFileNames);
      // Rebuild combined context
      await rebuildContext(allFileNames);
      let msg = `✓ Uploaded ${filesProcessed} file(s). Ready to answer questions!`;
      if (skipped > 0) msg += ` (${skipped} duplicate(s) skipped)`;
      setIndexResult(msg);
    } else if (!indexResult) { setIndexResult('✗ Could not extract text from uploaded files.'); }
    setIndexing(false); e.target.value = '';
  }

  // Rebuild combined context from individually stored files
  async function rebuildContext(fileNames: string[]) {
    const keys = fileNames.map(f => `file_text_${f}`);
    const result = await new Promise<Record<string, string>>((resolve) => {
      chrome.storage.local.get(keys, (r) => resolve(r as Record<string, string>));
    });
    let combined = '';
    for (const f of fileNames) {
      const text = result[`file_text_${f}`] || '';
      if (text) combined += `\n\n[${f}]\n${text}`;
    }
    try {
      await chrome.storage.local.set({ 'course_context_default-course': combined });
    } catch (err) {
      console.warn('Failed to store combined context:', err);
    }
    setTotalChars(combined.length);
  }

  // Delete individual file
  async function handleDeleteFile(fileName: string) {
    const newFiles = uploadedFiles.filter(f => f !== fileName);
    setUploadedFiles(newFiles);
    // Remove the file's stored text
    await chrome.storage.local.remove(`file_text_${fileName}`);
    
    if (newFiles.length === 0) {
      await chrome.storage.local.remove(['course_context_default-course', 'course_files_default-course']);
      setTotalChars(0);
      setIndexResult(null);
    } else {
      await chrome.storage.local.set({ 'course_files_default-course': newFiles });
      await rebuildContext(newFiles);
      setIndexResult(null);
    }
  }

  async function handleClearContext() {
    // Remove all file texts + context
    const keysToRemove = uploadedFiles.map(f => `file_text_${f}`);
    await chrome.storage.local.remove([...keysToRemove, 'course_context_default-course', 'course_files_default-course']);
    setUploadedFiles([]); setTotalChars(0);
    setIndexResult('Cleared. Upload new files to start fresh.');
  }

  // Open file preview: loads stored text for the file, optionally scrolling to a page
  async function handlePreviewFile(fileName: string, page?: number) {
    const result = await new Promise<Record<string, string>>((resolve) => {
      chrome.storage.local.get(`file_text_${fileName}`, (r) => resolve(r as Record<string, string>));
    });
    const text = result[`file_text_${fileName}`] || '(No text extracted)';
    setPreviewFile({ name: fileName, text, scrollToPage: page });
  }

  // Handle clicking a citation in an answer — opens file preview at the cited page
  function handleCitationClick(citationText: string) {
    // Try to extract file name and page number from citation text
    // Common patterns: "filename.pdf, Page 3", "filename.pdf — p.5", "[filename.pdf, Page 3]"
    const fileMatch = citationText.match(/[\w\-\.\s]+\.(pdf|pptx|docx|doc|odt|html|ipynb|txt|md|py|java|js|cpp|c|css|csv|m|tex)/i);
    const pageMatch = citationText.match(/[Pp]age\s*(\d+)|p\.?\s*(\d+)/);

    if (fileMatch) {
      const fileName = fileMatch[0].trim();
      const page = pageMatch ? parseInt(pageMatch[1] || pageMatch[2]) : undefined;

      // Check if the file is in our uploaded files list
      const matchedFile = uploadedFiles.find(f => f === fileName || f.includes(fileName) || fileName.includes(f.replace(/\.[^.]+$/, '')));
      if (matchedFile) {
        handlePreviewFile(matchedFile, page);
      }
    }
  }

  async function handleQuery() {
    if (!query.trim() || query.trim().length < 1) return;
    setQueryLoading(true);
    const res = await sendMessage({ type: 'PROCESS_QUERY', payload: { courseId: courseInfo?.courseId ?? 'default-course', query: query.trim() } });
    setQueryLoading(false);
    if (res?.type === 'QUERY_RESPONSE') {
      const entry = { query: query.trim(), answer: res.payload.answer, status: res.payload.status, citations: res.payload.citations };
      setAnswers((prev) => { const updated = [entry, ...prev]; persistHistory(updated); return updated; });
    } else if (res?.type === 'ERROR') {
      const entry = { query: query.trim(), answer: res.payload.message, status: 'error', citations: [] };
      setAnswers((prev) => { const updated = [entry, ...prev]; persistHistory(updated); return updated; });
    }
    setQuery('');
  }

  async function retryQuery(originalQuery: string, answerIndex: number) {
    setQueryLoading(true);
    const res = await sendMessage({ type: 'PROCESS_QUERY', payload: { courseId: courseInfo?.courseId ?? 'default-course', query: originalQuery } });
    setQueryLoading(false);
    if (res?.type === 'QUERY_RESPONSE') {
      const entry = { query: originalQuery, answer: res.payload.answer, status: res.payload.status, citations: res.payload.citations };
      setAnswers((prev) => { const updated = [...prev]; updated[answerIndex] = entry; persistHistory(updated); return updated; });
    } else if (res?.type === 'ERROR') {
      const entry = { query: originalQuery, answer: res.payload.message, status: 'error', citations: [] };
      setAnswers((prev) => { const updated = [...prev]; updated[answerIndex] = entry; persistHistory(updated); return updated; });
    }
  }

  function handleClearHistory() {
    if (!confirm('Clear all chat history? This cannot be undone.')) return;
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
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        body { margin: 0; background: ${theme.bg}; }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', paddingBottom: '12px', borderBottom: `2px solid ${theme.accent}` }}>
        <img src="../icons/icon48.png" alt="CourseChat" style={{ width: '28px', height: '28px', borderRadius: '8px' }} />
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
            ⚙️
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
          <p style={{ fontSize: '12px', margin: '6px 0 0', color: theme.textSecondary }}>Click the ⚙️ gear icon above to add your free Gemini API key and start asking questions.</p>
        </div>
      )}

      {/* Upload Section */}
      {hasKey && (
        <div style={{ marginBottom: '16px' }}>
          {/* Drag & Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation(); setDragOver(false);
              if (indexing) return;
              const files = e.dataTransfer.files;
              if (files && files.length > 0) {
                const fakeEvent = { target: { files, value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>;
                handleFileUpload(fakeEvent);
              }
            }}
            style={{
              border: `2px dashed ${dragOver ? theme.accent : theme.borderLight}`,
              borderRadius: '12px',
              padding: '16px',
              background: dragOver ? (darkMode ? '#1e293b' : '#eef6ff') : 'transparent',
              transition: 'all 0.2s ease',
              marginBottom: '8px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ padding: '9px 16px', background: theme.accent, color: '#fff', borderRadius: '8px', fontSize: '13px', cursor: indexing ? 'not-allowed' : 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '6px', opacity: indexing ? 0.6 : 1 }}>
                {indexing ? <><Spinner /> {uploadProgress ? `Processing ${uploadProgress.current}/${uploadProgress.total}...` : 'Processing...'}</> : '📁 Upload Files'}
                <input type="file" accept=".pdf,.pptx,.docx,.txt,.md,.py,.java,.js,.cpp,.c,.css,.csv,.ipynb,.html,.doc,.odt,.m,.tex" multiple style={{ display: 'none' }} onChange={handleFileUpload} disabled={indexing} />
              </label>
              {hasContent && (
                <button onClick={handleClearContext} style={{ padding: '9px 12px', background: theme.errorBg, color: theme.error, border: `1px solid ${theme.error}`, borderRadius: '8px', fontSize: '12px', cursor: 'pointer', fontWeight: 500 }}>🗑️ Clear Files</button>
              )}
            </div>
            <div style={{ marginTop: '8px', fontSize: '11px', color: theme.textMuted, textAlign: 'center' }}>
              {dragOver ? '⬇️ Drop files here to upload' : 'or drag & drop files here'}
            </div>
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
                <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px', background: darkMode ? '#2d3748' : '#f0f4f8', border: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, borderRadius: '20px', fontSize: '11px', color: theme.text, maxWidth: '100%', cursor: 'pointer' }} onClick={() => handlePreviewFile(f)} title={`Click to preview ${f}`}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {f}</span>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteFile(f); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: darkMode ? '#fc8181' : '#e53e3e', padding: '0', lineHeight: 1, flexShrink: 0 }} title="Remove file">×</button>
                </div>
              ))}
            </div>
          )}

          {indexResult && (
            <div style={{ fontSize: '12px', marginTop: '8px', color: indexResult.startsWith('✓') ? theme.success : indexResult.startsWith('Cleared') ? theme.textMuted : theme.error }}>
              {indexResult}
            </div>
          )}

          {/* Upload progress bar */}
          {uploadProgress && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '11px', color: theme.textMuted, marginBottom: '4px' }}>
                Processing: {uploadProgress.currentFile}
              </div>
              <div style={{ width: '100%', height: '4px', background: darkMode ? '#4a5568' : '#e2e8f0', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%`, height: '100%', background: theme.accent, borderRadius: '2px', transition: 'width 0.3s ease' }} />
              </div>
              <div style={{ fontSize: '10px', color: theme.textMuted, marginTop: '2px', textAlign: 'right' as const }}>
                {uploadProgress.current} of {uploadProgress.total}
              </div>
            </div>
          )}

          {/* Per-file error toasts */}
          {fileErrors.length > 0 && (
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {fileErrors.map((err, i) => (
                <div key={i} style={{ fontSize: '11px', padding: '6px 10px', background: theme.errorBg, border: `1px solid ${theme.error}`, borderRadius: '6px', color: theme.error, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✗ {err}</span>
                  <button onClick={() => setFileErrors(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.error, fontSize: '12px', flexShrink: 0, padding: 0 }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Query Input */}
      {hasKey && (
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: theme.textSecondary, display: 'block', marginBottom: '6px' }}>Ask a question about your course.</label>
          <textarea
            style={{ width: '100%', padding: '10px 12px', border: `2px solid ${theme.borderLight}`, borderRadius: '10px', fontSize: '14px', minHeight: '48px', maxHeight: '200px', resize: 'none' as const, boxSizing: 'border-box' as const, transition: 'border-color 0.2s', outline: 'none', background: theme.inputBg, color: theme.text, overflow: 'auto' }}
            placeholder="e.g. What are the deliverables for this week?"
            value={query} onChange={(e) => { setQuery(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }} onKeyDown={handleKeyDown} maxLength={2000} disabled={queryLoading}
            onFocus={(e) => { e.currentTarget.style.borderColor = theme.accent; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = theme.borderLight; }}
          />
          <div style={{ display: 'flex', marginTop: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button onClick={handleQuery} disabled={queryLoading || query.trim().length < 1} style={{ padding: '10px 20px', background: queryLoading || query.trim().length < 1 ? (darkMode ? '#3a5070' : '#a0c4f0') : '#1a73e8', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', cursor: queryLoading ? 'wait' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                {queryLoading ? <><Spinner /> Thinking...</> : 'Ask'}
              </button>
            </div>
            <span style={{ fontSize: '11px', color: theme.textMuted }}>{query.length}/2000</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
            <button onClick={() => setShowTips(!showTips)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: theme.accent, padding: 0, fontWeight: 500 }}>
              💡 {showTips ? 'Hide tips' : 'Tips & shortcuts'}
            </button>
          </div>
          {showTips && (
            <div style={{ marginTop: '8px', padding: '10px 12px', background: darkMode ? '#1e2a3a' : '#f0f7ff', border: `1px solid ${darkMode ? '#2d4a6f' : '#bdd7f1'}`, borderRadius: '8px', fontSize: '11px', color: theme.textSecondary, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 600, marginBottom: '6px', fontSize: '12px' }}>💡 Tips for using CourseChat</div>
              <div>🎤 <strong>Voice typing:</strong> Click the text box, then press <strong>Win+H</strong> (Windows) or <strong>Cmd+Control+Space</strong> (Mac) to dictate your question</div>
              <div>⌨️ <strong>Keyboard shortcut:</strong> Set a shortcut at <span style={{ fontFamily: 'monospace', fontSize: '10px', background: darkMode ? '#2d3748' : '#e2e8f0', padding: '1px 4px', borderRadius: '3px' }}>chrome://extensions/shortcuts</span> (e.g. Alt+Shift+C)</div>
              <div>📄 <strong>File preview:</strong> Click any uploaded file tile to see the extracted text</div>
              <div>📋 <strong>Copy answers:</strong> Use the Copy button to paste well-formatted text into your notes</div>
              <div>🔊 <strong>Listen:</strong> Click Listen to hear answers read aloud</div>
              <div>📥 <strong>Export:</strong> Export your full Q&A session as a Markdown file</div>
              <div>🗑️ <strong>Manage:</strong> Delete individual Q&As with the ✕ button, or clear all with Clear All</div>
              <div>⏎ <strong>Quick ask:</strong> Press Enter to submit your question (Shift+Enter for new line)</div>
              <div>📂 <strong>Supported files:</strong> PDF, PPTX, DOCX, DOC, ODT, HTML, Jupyter, TXT, source code, CSV</div>
              <div style={{ marginTop: '6px', color: theme.textMuted, fontSize: '10px' }}>Tip: Upload all your course materials at once for the best answers!</div>
            </div>
          )}
        </div>
      )}

      {/* Answer History */}
      {answers.length > 0 && (
        <div>
          {/* Clear All + Export buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '10px' }}>
            <button
              onClick={handleExportChat}
              title="Export chat as Markdown"
              style={{
                padding: '6px 12px',
                background: theme.hoverBg,
                color: theme.textSecondary,
                border: `1px solid ${theme.border}`,
                borderRadius: '8px',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              📥 Export
            </button>
            <button
              onClick={handleClearHistory}
              title="Clear all chat history"
              style={{
                padding: '6px 12px',
                background: theme.errorBg,
                color: theme.error,
                border: `1px solid ${theme.error}`,
                borderRadius: '8px',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              🗑️ Clear All
            </button>
          </div>
          {answers.map((a, i) => (
            <div key={i} style={{ marginBottom: '16px', padding: '14px', background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: `0 1px 3px ${theme.shadow}`, position: 'relative' as const }}>
              <button onClick={() => { const updated = answers.filter((_, idx) => idx !== i); setAnswers(updated); persistHistory(updated); }} style={{ position: 'absolute' as const, top: '8px', right: '8px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: theme.textMuted, opacity: 0.6 }} title="Delete this Q&A">✕</button>
              <div style={{ fontSize: '13px', fontWeight: 600, color: theme.text, marginBottom: '8px', paddingRight: '20px' }}>Q: {a.query}</div>
              <div style={{ fontSize: '13px', lineHeight: 1.6, color: darkMode ? '#ccc' : '#333' }}>
                {a.status === 'success' && <FormattedAnswer text={a.answer} onCitationClick={handleCitationClick} />}
                {a.status === 'low_confidence' && (
                  <>
                    <span style={{ background: theme.warningBg, color: theme.warningText, padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 500 }}>Low confidence</span><br /><br />
                    <FormattedAnswer text={a.answer} onCitationClick={handleCitationClick} />
                  </>
                )}
                {a.status === 'insufficient_information' && (
                  <span style={{ color: theme.textMuted, fontStyle: 'italic' }}>Couldn't find enough information in the course materials to answer this question.</span>
                )}
                {a.status === 'retrieval_error' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ color: theme.error }}>{a.answer || 'Unable to retrieve an answer.'}</span>
                    <button onClick={() => retryQuery(a.query, i)} disabled={queryLoading} style={{ padding: '4px 10px', background: theme.accent, color: '#fff', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}>↻ Try again</button>
                  </div>
                )}
                {a.status === 'error' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ color: theme.error }}>{a.answer}</span>
                    <button onClick={() => retryQuery(a.query, i)} disabled={queryLoading} style={{ padding: '4px 10px', background: theme.accent, color: '#fff', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}>↻ Try again</button>
                  </div>
                )}
              </div>
              {/* Copy + Speaker buttons */}
              <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <CopyButton text={a.answer} theme={theme} />
                <SpeakButton text={a.answer} theme={theme} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', flexDirection: 'column', padding: '12px' }} onClick={() => setPreviewFile(null)}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: darkMode ? '#1a202c' : '#ffffff', borderRadius: '12px', overflow: 'hidden', border: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: darkMode ? '#2d3748' : '#f7fafc' }}>
              <span style={{ fontWeight: 600, fontSize: '13px', color: darkMode ? '#e2e8f0' : '#1a202c' }}>📄 {previewFile.name}{previewFile.scrollToPage ? ` — Page ${previewFile.scrollToPage}` : ''}</span>
              <button onClick={() => setPreviewFile(null)} style={{ background: darkMode ? '#4a5568' : '#edf2f7', border: 'none', cursor: 'pointer', fontSize: '14px', color: darkMode ? '#e2e8f0' : '#4a5568', padding: '4px 8px', borderRadius: '6px', fontWeight: 600 }}>✕ Close</button>
            </div>
            <div
              ref={(el) => {
                if (el && previewFile.scrollToPage) {
                  // Scroll to the [Page X] marker after the modal renders
                  setTimeout(() => {
                    const pageMarker = `[Page ${previewFile.scrollToPage}]`;
                    const idx = previewFile.text.indexOf(pageMarker);
                    if (idx >= 0) {
                      // Calculate approximate scroll position based on character index
                      const textBefore = previewFile.text.slice(0, idx);
                      const linesBefore = textBefore.split('\n').length;
                      const lineHeight = 20; // approximate px per line
                      el.scrollTop = Math.max(0, linesBefore * lineHeight - 40);
                    }
                  }, 100);
                }
              }}
              style={{ flex: 1, overflow: 'auto', padding: '16px', fontSize: '12px', lineHeight: 1.7, color: darkMode ? '#cbd5e0' : '#2d3748', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: "'Consolas', 'Monaco', monospace", background: darkMode ? '#1a202c' : '#ffffff' }}
            >
              {previewFile.text}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><App /></React.StrictMode>);
