/// <reference types="chrome" />

import { useEffect, useState } from 'react';
import type { RAGResponse, HistoryEntry } from '@/types';
import { addHistoryEntry, getHistoryByCourseSession } from '@/background/db';

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
        return;
      }

      try {
        const entries = await getHistoryByCourseSession(courseId, sessionId);
        if (!cancelled) {
          setHistory(entries.sort((left, right) => right.timestamp.localeCompare(left.timestamp)).map(toDisplayItem));
        }
      } catch {
        if (!cancelled) {
          setHistory([]);
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

    const entry: HistoryEntry = {
      id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : createFallbackId(),
      courseId,
      sessionId,
      query,
      response: toHistoryResponse(response),
      timestamp: new Date().toISOString(),
    };

    await addHistoryEntry(entry);
    setHistory((current) => [response, ...current]);
  }

  return {
    history,
    isLoading,
    recordResponse,
  };
}
