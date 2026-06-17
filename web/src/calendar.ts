import {
  startOfWeek,
  startOfMonth,
  addDays,
  addWeeks,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
} from "date-fns";

export const HOUR_HEIGHT = 44; // px per hour in the week grid
export const SNAP_MINUTES = 30; // slot start snapping
export const DAY_HEIGHT = HOUR_HEIGHT * 24;

/** Monday as the first day of the week, matching Google Calendar's common default. */
export function weekStart(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 1 });
}

export function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function shiftWeek(start: Date, by: number): Date {
  return addWeeks(start, by);
}

/** First cell of a month grid: the Monday on or before the 1st. */
export function monthGridStart(d: Date): Date {
  return startOfWeek(startOfMonth(d), { weekStartsOn: 1 });
}

/** A fixed 6-week (42 day) grid covering the month, like Google Calendar. */
export function monthDays(d: Date): Date[] {
  const start = monthGridStart(d);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function shiftMonth(d: Date, by: number): Date {
  return addMonths(d, by);
}

/** minutes since local midnight for an epoch-ms timestamp */
export function minutesIntoDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/** Build an epoch-ms timestamp from a day + minutes-into-day, in local time. */
export function timestampFor(day: Date, minutes: number): number {
  const base = startOfDay(day);
  return base.getTime() + minutes * 60_000;
}

export function formatHourLabel(hour: number): string {
  if (hour === 0) return "";
  return format(new Date(2000, 0, 1, hour), "ha").toLowerCase();
}

export function formatSlotTime(ms: number): string {
  return format(new Date(ms), "EEE d MMM, HH:mm");
}

export function formatSlotDay(ms: number): string {
  return format(new Date(ms), "EEE d MMM");
}

export function formatTimeRange(ms: number, durationMinutes: number): string {
  const start = new Date(ms);
  const end = new Date(ms + durationMinutes * 60_000);
  return `${format(start, "HH:mm")}–${format(end, "HH:mm")}`;
}

export { isSameDay, isSameMonth, format };
