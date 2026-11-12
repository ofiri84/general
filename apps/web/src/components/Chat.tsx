import type { ChatMessage } from "@yachad/shared";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { listen, speak, speechInputSupported, speechOutputSupported, stopSpeaking, type Listener } from "../speech";
import { MicIcon, SendIcon, SparkIcon, SpeakerIcon } from "./icons";

const SUGGESTIONS = [
  "מה יש לנו להיום?",
  "תוסיף לקנות חלב ולחם מחר",
  "תכין לנו תוכנית לארוחת שבת",
  "חפש בדרייב את הביטוח של הרכב",
];

export function Chat({ onTasksChanged }: { onTasksChanged: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(() => localStorage.getItem("yachad.voiceReplies") === "1");
  const listener = useRef<Listener>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.history().then(setMessages).catch(() => {});
    return () => stopSpeaking();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || busy) return;
      stopSpeaking();
      setInput("");
      setBusy(true);
      setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, role: "user", text: clean, createdAt: new Date().toISOString() }]);
      try {
        const res = await api.chat(clean);
        setMessages((prev) => [...prev.filter((m) => !m.id.startsWith("tmp-")), res.userMessage, res.reply]);
        if (res.tasksChanged) onTasksChanged();
        if (voiceReplies) speak(res.reply.text);
      } catch {
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: "assistant", text: "לא הצלחתי להתחבר. נסו שוב בעוד רגע.", createdAt: new Date().toISOString() },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, onTasksChanged, voiceReplies],
  );

  function toggleMic() {
    if (listening) {
      listener.current?.stop();
      return;
    }
    stopSpeaking();
    setListening(true);
    let finalText = "";
    listener.current = listen({
      onText: (text, final) => {
        setInput(text);
        if (final) finalText = text;
      },
      onEnd: (error) => {
        setListening(false);
        if (error === "not-allowed" || error === "service-not-allowed") {
          alert("צריך לאשר גישה למיקרופון בהגדרות הדפדפן");
        } else if (finalText) {
          void send(finalText);
        }
      },
    });
  }

  function toggleVoiceReplies() {
    const next = !voiceReplies;
    setVoiceReplies(next);
    localStorage.setItem("yachad.voiceReplies", next ? "1" : "0");
    if (!next) stopSpeaking();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <section className="screen chat">
      <header className="screen-header">
        <div>
          <h1>העוזר שלנו</h1>
          <p className="muted">אפשר לכתוב או לדבר. אני גם יודע לעשות דברים בעצמי.</p>
        </div>
        {speechOutputSupported() && (
          <button
            className={`icon-btn ${voiceReplies ? "active" : ""}`}
            onClick={toggleVoiceReplies}
            aria-label={voiceReplies ? "כיבוי הקראה" : "הפעלת הקראה"}
            aria-pressed={voiceReplies}
          >
            <SpeakerIcon off={!voiceReplies} />
          </button>
        )}
      </header>

      <div className="messages" aria-live="polite">
        {messages.length === 0 && !busy && (
          <div className="welcome">
            <div className="welcome-icon">
              <SparkIcon />
            </div>
            <p>במה אפשר לעזור היום?</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            <p>{m.text}</p>
            {m.actions?.map((a, i) => (
              <span key={i} className="action">
                <SparkIcon /> {a.label}
              </span>
            ))}
          </div>
        ))}
        {busy && (
          <div className="bubble assistant typing" aria-label="העוזר חושב">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        {speechInputSupported() && (
          <button
            type="button"
            className={`icon-btn mic ${listening ? "listening" : ""}`}
            onClick={toggleMic}
            aria-label={listening ? "עצירת הקלטה" : "דיבור"}
          >
            <MicIcon size={24} />
          </button>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "מקשיב..." : "כתבו הודעה..."}
          aria-label="הודעה"
        />
        <button className="icon-btn primary" disabled={!input.trim() || busy} aria-label="שליחה">
          <SendIcon />
        </button>
      </form>
    </section>
  );
}
