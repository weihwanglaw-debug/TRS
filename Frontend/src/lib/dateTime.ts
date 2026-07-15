const DEFAULT_TIME_ZONE = "+08:00";
const DEFAULT_DATE_TIME_FORMAT = "dd/MM/yyyy HH:mm:ss";

type DatePartMap = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

function normalizeTimestamp(value?: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseUtcOffsetMinutes(offset?: string): number {
  const match = (offset || DEFAULT_TIME_ZONE).trim().match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return 8 * 60;

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59) return 8 * 60;
  return sign * ((hours * 60) + minutes);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getParts(date: Date, utcOffset?: string): DatePartMap {
  const offsetMinutes = parseUtcOffsetMinutes(utcOffset);
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);

  return {
    year: String(shifted.getUTCFullYear()),
    month: pad2(shifted.getUTCMonth() + 1),
    day: pad2(shifted.getUTCDate()),
    hour: pad2(shifted.getUTCHours()),
    minute: pad2(shifted.getUTCMinutes()),
    second: pad2(shifted.getUTCSeconds()),
  };
}

export function formatConfiguredDateTime(
  value?: string | Date | null,
  utcOffset = DEFAULT_TIME_ZONE,
  pattern = DEFAULT_DATE_TIME_FORMAT,
  fallback = "-",
): string {
  const date = normalizeTimestamp(value);
  if (!date) return fallback;

  try {
    const parts = getParts(date, utcOffset);
    return (pattern || DEFAULT_DATE_TIME_FORMAT)
      .replace(/yyyy/g, parts.year)
      .replace(/MM/g, parts.month)
      .replace(/dd/g, parts.day)
      .replace(/HH/g, parts.hour)
      .replace(/mm/g, parts.minute)
      .replace(/ss/g, parts.second);
  } catch {
    const parts = getParts(date, DEFAULT_TIME_ZONE);
    return DEFAULT_DATE_TIME_FORMAT
      .replace(/yyyy/g, parts.year)
      .replace(/MM/g, parts.month)
      .replace(/dd/g, parts.day)
      .replace(/HH/g, parts.hour)
      .replace(/mm/g, parts.minute)
      .replace(/ss/g, parts.second);
  }
}

export function configuredDateKey(
  value?: string | Date | null,
  utcOffset = DEFAULT_TIME_ZONE,
): string {
  const date = normalizeTimestamp(value);
  if (!date) return "";
  const parts = getParts(date, utcOffset);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const DEFAULT_DISPLAY_TIME_ZONE = DEFAULT_TIME_ZONE;
export const DEFAULT_DISPLAY_DATE_TIME_FORMAT = DEFAULT_DATE_TIME_FORMAT;
