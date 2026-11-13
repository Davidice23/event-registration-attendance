export function formatBangkokDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Bangkok", timeZoneName: "short",
  }).format(new Date(value));
}
