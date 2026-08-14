/// <reference types="chrome" />

import { useEffect, useState } from 'react';
import type { RAGResponse, HistoryEntry } from '@/types';
import { addHistoryEntry, getHistoryByCourseSession, deleteHistoryEntry } from '@/background/db';

const SESSION_STORAGE_KEY = 'coursechat-session-id';

export interface SessionAnswerItem {
  query: string;
  answer: string;
  status: RAGResponse['status'] | 'error';
  citations: RAGResponse['citations'];
}

function createFallbackId() {
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function getOrCreateSessionId(): Promise<string> {
  // Uses chrome.storage.local (not .session) so the id — and therefore the
  // chat history filed under it — survives full browser restarts, not just
  // tab closes. .session is wiped by Chrome on browser close by design.
  const existing = await chrome.storage.local.get(SESSION_STORAGE_KEY);
  const current = existing[SESSION_STORAGE_KEY];
  if (typeof current === 'string' && current.length > 0) {
    return current;
  }

  const sessionId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : createFallbackId();
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: sessionId });
  return sessionId;
}

function toDisplayItem(entry: HistoryEntry): SessionAnswerItem {
  return {
    query: entry.query,
    answer: entry.response.answer,
    status: entry.response.status,
    citations: entry.response.citations,
  };
}

function toHistoryResponse(item: SessionAnswerItem): RAGResponse {
  const responseStatus = item.status === 'error' ? 'retrieval_error' : item.status;

  return {
    answer: item.answer,
    citations: item.citations,
    status: responseStatus,
    confidenceScore: responseStatus === 'success' ? 1 : responseStatus === 'low_confidence' ? 0.5 : 0,
  };
}

export function useSessionHistory(courseId: string) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<SessionAnswerItem[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function initializeSession() {
      try {
        const resolvedSessionId = await getOrCreateSessionId();
        if (!cancelled) {
          setSessionId(resolvedSessionId);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    initializeSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      if (!sessionId || !courseId) {
        setHistory([]);
        setEntryIds([]);
        return;
      }

      try {
        const entries = await getHistoryByCourseSession(courseId, sessionId);
        const sorted = entries.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
        if (!cancelled) {
          setHistory(sorted.map(toDisplayItem));
          setEntryIds(sorted.map((entry) => entry.id));
        }
      } catch {
        if (!cancelled) {
          setHistory([]);
          setEntryIds([]);
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [courseId, sessionId]);

  async function recordResponse(query: string, response: SessionAnswerItem) {
    if (!sessionId || !courseId) {
      return;
    }

    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : createFallbackId();
    const entry: HistoryEntry = {
      id,
      courseId,
      sessionId,
      query,
      response: toHistoryResponse(response),
      timestamp: new Date().toISOString(),
    };

    await addHistoryEntry(entry);
    setHistory((current) => [response, ...current]);
    setEntryIds((current) => [id, ...current]);
  }

  async function clearHistory() {
    await Promise.all(entryIds.map((id) => deleteHistoryEntry(id)));
    setHistory([]);
    setEntryIds([]);
  }

  return {
    history,
    isLoading,
    recordResponse,
    clearHistory,
  };
}