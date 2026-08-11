export const numberFormatter = new Intl.NumberFormat("de-DE");

export function formatNumber(value: number) {
  return numberFormatter.format(Math.round(value));
}

export function formatPercent(currentHp: number, maxHp: number) {
  const percent = maxHp > 0 ? (currentHp / maxHp) * 100 : 0;
  return percent.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatLogTime(timestamp: string) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}
