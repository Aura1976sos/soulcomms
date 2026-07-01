import { useState, useRef, useCallback } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";

export interface SolutionMessage {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  isFallback?: boolean;
}

export interface PageContext {
  page: string;
  role: string;
  online: boolean;
  eventName?: string;
}

// Page-aware fallback guidance — shown when AI is unavailable
const PAGE_FALLBACKS: Record<string, string> = {
  checkin: [
    "Solution AI is temporarily unavailable. Here's quick guidance:",
    "",
    "• QR scan → participant found → check in normally",
    "• QR scan → not found → tap 'Add Participant & Check In' → enter name, code, phone",
    "• Manual code → not found → tap 'Add Participant' to register as walk-in",
    "• Offline mode: all check-ins save locally and sync automatically when internet returns",
  ].join("\n"),

  activity_recorder: [
    "Solution AI is temporarily unavailable. Here's quick guidance:",
    "",
    "• Participants must complete event check-in before recording activities",
    "• 'Not checked in' → direct them to the Check-In Station first",
    "• 'Already recorded' → duplicate prevention is working, no action needed",
    "• 'Not found' → send them to the Check-In Station for registration",
  ].join("\n"),

  staff: [
    "Solution AI is temporarily unavailable. Here's quick guidance:",
    "",
    "• Create staff: use the Create Staff tab, select a role, fill in details",
    "• Disable account: find the staff member in Directory tab, click Disable",
    "• Force logout: go to Active Sessions tab, click Force Logout",
    "• Roles: Admin (full access), Event Admin (manage events), Check-In Officer (check-in only)",
  ].join("\n"),

  dashboard: [
    "Solution AI is temporarily unavailable.",
    "",
    "Dashboard metrics: Attendance % = checked in divided by total registered times 100.",
    "Activity figures show unique participants per activity.",
    "Leaderboard ranks by total points earned across all activities.",
  ].join("\n"),

  participants: [
    "Solution AI is temporarily unavailable.",
    "",
    "Use the search bar to find participants by name or code.",
    "To check someone in, go to the Check-In Station page.",
  ].join("\n"),

  offline: [
    "You are currently operating offline.",
    "",
    "All operations continue normally — check-ins, walk-ins, and activity recording all work offline.",
    "Records synchronize automatically when internet connectivity is restored.",
  ].join("\n"),

  general: [
    "Solution AI is temporarily unavailable.",
    "",
    "Please try again in a moment. For urgent help, contact your event administrator.",
  ].join("\n"),
};

function getFallback(page: string, online: boolean): string {
  if (!online) return PAGE_FALLBACKS.offline;
  return PAGE_FALLBACKS[page] || PAGE_FALLBACKS.general;
}

function logError(context: { role: string; page: string; errorType: string; message: string }) {
  console.warn("[Solution Diagnostic]", {
    timestamp: new Date().toISOString(),
    browser: navigator.userAgent,
    online: navigator.onLine,
    ...context,
  });
}

function updateLastAssistant(messages: SolutionMessage[], update: Partial<SolutionMessage>): SolutionMessage[] {
  const updated = [...messages];
  const last = updated[updated.length - 1];
  if (last?.role === "assistant") Object.assign(last, update);
  return updated;
}

export function useSolutionChat() {
  const [messages, setMessages] = useState<SolutionMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const abortRef = useRef<AbortController | null>(null);

  const injectFallback = useCallback((pageContext: PageContext, errorType: string, errorMsg: string) => {
    logError({ role: pageContext.role, page: pageContext.page, errorType, message: errorMsg });
    setAiUnavailable(true);
    const fallbackContent = getFallback(pageContext.page, pageContext.online);
    setMessages(prev => updateLastAssistant([...prev], {
      content: fallbackContent,
      isStreaming: false,
      isFallback: true,
    }));
    setIsLoading(false);
  }, []);

  const sendMessage = useCallback(async (content: string, pageContext: PageContext) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const userMsg: SolutionMessage = { role: "user", content };
    const assistantMsg: SolutionMessage = { role: "assistant", content: "", isStreaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsLoading(true);
    setAiUnavailable(false);

    try {
      await fetchEventSource(`${SUPABASE_URL}/functions/v1/solution-assistant`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          "X-Session-ID": sessionIdRef.current,
        },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
          pageContext,
        }),
        signal: abortRef.current.signal,

        // Level 0: parse SSE error on non-2xx responses
        async onopen(response) {
          const ct = response.headers.get("content-type") || "";
          if (!response.ok) {
            let errorMessage = `Request failed: ${response.status}`;
            let errorType = "api_error";
            if (ct.includes("text/event-stream")) {
              const text = await response.text();
              const match = text.match(/data: (.+)/);
              if (match) {
                try {
                  const d = JSON.parse(match[1]);
                  if (d.error?.message) {
                    errorMessage = d.error.message;
                    errorType = d.error.type || "api_error";
                  }
                } catch { /* use default */ }
              }
            } else if (ct.includes("application/json")) {
              try {
                const d = await response.json();
                if (d.error?.message) {
                  errorMessage = d.error.message;
                  errorType = d.error.type || "api_error";
                }
              } catch { /* use default */ }
            }
            const e = new Error(errorMessage) as Error & { errorType: string };
            e.errorType = errorType;
            throw e;
          }
        },

        // Level 1: stream events (OpenAI Chat Completions protocol)
        onmessage(event) {
          if (!event.data || event.data === "[DONE]") return;
          let data: Record<string, unknown>;
          try { data = JSON.parse(event.data); } catch { return; }

          if (data.error) {
            const err = data.error as { type?: string; message?: string };
            injectFallback(pageContext, err.type || "api_error", err.message || "Stream error");
            return;
          }

          const choice = (data.choices as Array<{
            delta?: { content?: string };
            finish_reason?: string | null;
          }>)?.[0];
          if (!choice) return;

          if (choice.delta?.content) {
            setAiUnavailable(false);
            setMessages(prev =>
              updateLastAssistant([...prev], {
                content: (prev[prev.length - 1]?.content || "") + choice.delta!.content,
              })
            );
          }
          if (choice.finish_reason) {
            setMessages(prev => updateLastAssistant([...prev], { isStreaming: false }));
            setIsLoading(false);
          }
        },

        // Level 2: network errors
        onerror(err) { throw err; },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessages(prev => updateLastAssistant([...prev], { isStreaming: false }));
        setIsLoading(false);
      } else if (err instanceof Error) {
        const errorType = (err as Error & { errorType?: string }).errorType || "network_error";
        injectFallback(pageContext, errorType, err.message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [messages, injectFallback]);

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);

  const resetChat = useCallback(() => {
    abortRef.current?.abort();
    sessionIdRef.current = crypto.randomUUID();
    setMessages([]);
    setAiUnavailable(false);
    setIsLoading(false);
  }, []);

  return { messages, isLoading, aiUnavailable, sendMessage, cancel, resetChat };
}
