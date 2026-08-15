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
 * Looks for patterns like "page X", "slide X", or file name mentions.
 */
function extractCitationsFromResponse(text: string): Array<{ fileName: string; pageNumber: number; sectionHeading: string }> {
  const citations: Array<{ fileName: string; pageNumber: number; sectionHeading: string }> = [];

  // Match patterns like "page 5", "slide 3", "p. 12"
  const pageMatches = text.matchAll(/(?:page|slide|p\.?)\s*(\d+)/gi);
  for (const match of pageMatches) {
    citations.push({
      fileName: 'Course Material',
      pageNumber: parseInt(match[1]),
      sectionHeading: '',
    });
  }

  // Deduplicate by page number
  const seen = new Set<number>();
  return citations.filter((c) => {
    if (seen.has(c.pageNumber)) return false;
    seen.add(c.pageNumber);
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
