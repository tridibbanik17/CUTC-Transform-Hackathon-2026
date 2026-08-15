// ============================================================
// Direct Gemini Query (Demo Mode)
// Sends user query + course context directly to Gemini API
// Bypasses Backboard.io for a working demo without backend.
// Will be replaced by full RAG pipeline when Backboard.io is wired.
// ============================================================

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-3.5-flash-lite';

interface DirectQueryResult {
  answer: string;
  status: 'success' | 'low_confidence' | 'insufficient_information' | 'retrieval_error';
  citations: Array<{ fileName: string; pageNumber: number; sectionHeading: string }>;
}

/**
 * Query Gemini directly with course content as context.
 * This is a demo/fallback mode that doesn't use Backboard.io.
 */
export async function directGeminiQuery(
  apiKey: string,
  query: string,
  courseContext: string,
  courseName: string
): Promise<DirectQueryResult> {
  const systemPrompt = `You are CourseChat, an AI study tutor for the course "${courseName}". 
You ONLY answer questions based on the provided course materials below. 
If the answer is clearly not in the materials at all, say "I couldn't find this information in your course materials."
However, if the question is related to topics in the materials, answer it even if the exact wording doesn't match. Be helpful, not overly strict.
Always cite which document and page/section the information comes from.
Keep answers thorough but well-structured. Use bullet points for clarity.
Do NOT use LaTeX notation. Use plain text with Unicode symbols for units (e.g. Ω, °C, µ, ², ³).

COURSE MATERIALS:
${courseContext}`;

  const url = `${GEMINI_API_BASE}/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\nSTUDENT QUESTION: ${query}` }] }
        ],
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.2,
        },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      const errorBody = await response.text().catch(() => '');
      if (status === 429) {
        return { answer: 'Rate limit reached. Please wait a moment and try again.', status: 'retrieval_error', citations: [] };
      }
      if (status === 401 || status === 403) {
        return { answer: 'API key is invalid or unauthorized.', status: 'retrieval_error', citations: [] };
      }
      return { answer: `Gemini API error (${status}): ${errorBody.slice(0, 200)}`, status: 'retrieval_error', citations: [] };
    }

    const data = await response.json();
    // Thinking models may return multiple parts - get the last text part (the actual response)
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const textParts = parts.filter((p: any) => p.text && !p.thought);
    const text = textParts.length > 0 ? textParts[textParts.length - 1].text : (parts[parts.length - 1]?.text ?? '');

    if (!text) {
      return { answer: 'No response generated.', status: 'insufficient_information', citations: [] };
    }

    // Try to extract citation hints from the response
    const citations = extractCitationsFromResponse(text);

    return { answer: text, status: 'success', citations };
  } catch (err) {
    return {
      answer: `Network error: ${err instanceof Error ? err.message : 'Unknown'}`,
      status: 'retrieval_error',
      citations: [],
    };
  }
}

/**
 * Extract citation-like references from Gemini's response text.
 * Looks for patterns like "Source: [filename], Page X" or "page X" with
 * context from the course material markers ([fileName]) in the prompt.
 */
function extractCitationsFromResponse(text: string): Array<{ fileName: string; pageNumber: number; sectionHeading: string }> {
  const citations: Array<{ fileName: string; pageNumber: number; sectionHeading: string }> = [];

  // Match explicit source references: [chapter 2.pdf], Page 14 or Source: [file.pdf], Page 7
  const sourceMatches = text.matchAll(/\[([^\]]+\.\w+)\][\s,]*(?:page|pages|p\.?)\s*([\d]+(?:\s*(?:and|,)\s*\d+)*)/gi);
  for (const match of sourceMatches) {
    const fileName = match[1];
    // Handle "Pages 12 and 14" → extract each page number
    const pageNums = match[2].match(/\d+/g) ?? [];
    for (const p of pageNums) {
      citations.push({ fileName, pageNumber: parseInt(p), sectionHeading: '' });
    }
  }

  // Deduplicate by fileName + pageNumber
  const seen = new Set<string>();
  return citations.filter((c) => {
    const key = `${c.fileName}:${c.pageNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Store indexed course content in chrome.storage.local for demo mode.
 * Stores extracted text so it can be used as context for queries.
 */
export async function storeCourseContext(courseId: string, context: string): Promise<void> {
  await chrome.storage.local.set({ [`course_context_${courseId}`]: context });
}

/**
 * Retrieve stored course context for a given course.
 */
export async function getCourseContext(courseId: string): Promise<string | null> {
  const result = await chrome.storage.local.get(`course_context_${courseId}`);
  return result[`course_context_${courseId}`] ?? null;
}
