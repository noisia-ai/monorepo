"use client";

import { useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { SourceToken } from "@/components/ui/SourceIcon";

type ChatEvidence = {
  source_type: "knowledge_source" | "mention";
  title: string | null;
  platform: string | null;
  published_at: string | null;
  similarity: number;
  text: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  evidence?: ChatEvidence[];
};

export function SignalCorpusChat({ outputId }: { outputId: string }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Preguntame por el reporte, la evidencia del corpus o como se conecta el Knowledge Base con los findings publicados."
    }
  ]);
  const [loading, setLoading] = useState(false);

  async function submit() {
    const clean = question.trim();
    if (!clean || loading) return;
    setQuestion("");
    setMessages((current) => [...current, { role: "user", text: clean }]);
    setLoading(true);

    try {
      const res = await fetch(`/api/signal/${outputId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: clean })
      });
      const json = await res.json();
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: typeof json.answer === "string" ? json.answer : "No pude responder esta pregunta con el contexto disponible.",
          evidence: Array.isArray(json.evidence) ? json.evidence : []
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: `No pude consultar el agente del corpus: ${error instanceof Error ? error.message : "error desconocido"}.`
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="signal-chat-shell">
      <div className="signal-chat-thread" aria-live="polite">
        {messages.map((message, index) => (
          <article className={`signal-chat-message signal-chat-message--${message.role}`} key={`${message.role}-${index}`}>
            <div className="signal-chat-bubble">
              <p>{message.text}</p>
            </div>
            {message.evidence && message.evidence.length > 0 ? (
              <div className="signal-chat-evidence">
                {message.evidence.slice(0, 5).map((item, evidenceIndex) => (
                  <div key={`${item.source_type}-${evidenceIndex}`}>
                    <header>
                      {item.source_type === "mention" ? (
                        <SourceToken compact value={item.platform || "corpus"} />
                      ) : (
                        <span className="source-token source-token--compact">KB</span>
                      )}
                      <small>{Math.round(item.similarity * 100)}% match</small>
                    </header>
                    <p>{item.text}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        ))}
        {loading ? (
          <article className="signal-chat-message signal-chat-message--assistant">
            <div className="signal-chat-bubble">
              <p><Icon name="spinner" size={14} /> Buscando evidencia semantica...</p>
            </div>
          </article>
        ) : null}
      </div>

      <form
        className="signal-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          <span>Pregunta</span>
          <textarea
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ej. ¿Qué contradice el knowledge base frente al corpus? ¿Qué evidencia hay sobre confianza?"
            rows={3}
            value={question}
          />
        </label>
        <button className="signal-chat-submit" disabled={loading || question.trim().length < 3} type="submit">
          {loading ? <Icon name="spinner" size={15} /> : <Icon name="message" size={15} />}
          Preguntar
        </button>
      </form>
    </section>
  );
}
