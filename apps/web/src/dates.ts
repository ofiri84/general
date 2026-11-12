const pad = (n: number) => String(n).padStart(2, "0");

export function toIso(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayIso = () => toIso(new Date());

export function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return toIso(new Date(y, m - 1, d + days));
}

export function diffDays(iso: string, from = todayIso()) {
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(iso) - parse(from)) / 86400_000);
}

const weekdays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function formatDue(iso: string) {
  const diff = diffDays(iso);
  if (diff === 0) return "היום";
  if (diff === 1) return "מחר";
  if (diff === -1) return "אתמול";
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  if (diff > 1 && diff < 7) return `יום ${weekdays[date.getDay()]}`;
  return `${d}.${m}`;
}
