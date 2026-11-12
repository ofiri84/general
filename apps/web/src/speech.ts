/* Browser speech APIs (Hebrew). Supported on Chrome/Android and Safari/iOS; unsupported browsers fall back to typing. */

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const speechInputSupported = () => !!ctor();
export const speechOutputSupported = () => "speechSynthesis" in window;

export interface Listener {
  stop(): void;
}

export function listen(handlers: {
  onText: (text: string, final: boolean) => void;
  onEnd: (error?: string) => void;
}): Listener {
  const Ctor = ctor();
  if (!Ctor) {
    handlers.onEnd("unsupported");
    return { stop() {} };
  }
  const rec = new Ctor();
  rec.lang = "he-IL";
  rec.interimResults = true;
  rec.continuous = false;
  let error: string | undefined;
  rec.onresult = (e) => {
    let text = "";
    let final = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      text += r[0]?.transcript ?? "";
      final = final || r.isFinal;
    }
    handlers.onText(text, final);
  };
  rec.onerror = (e) => {
    error = e.error;
  };
  rec.onend = () => handlers.onEnd(error);
  rec.start();
  return { stop: () => rec.stop() };
}

export function speak(text: string) {
  if (!speechOutputSupported()) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "he-IL";
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("he"));
  if (voice) utter.voice = voice;
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  if (speechOutputSupported()) window.speechSynthesis.cancel();
}
