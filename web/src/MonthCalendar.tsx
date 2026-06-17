import { useMemo, useState } from "react";
import { monthDays, shiftMonth, timestampFor, isSameDay, isSameMonth, format } from "./calendar";
import type { VoteChoice } from "./types";

export interface MonthSlot {
  id: string;
  startsAt: number;
  /** The viewer's own vote, which fills the day box. */
  myChoice?: VoteChoice;
  leading?: boolean;
  /** Number of "yes" votes, shown as the big number in the box. */
  count?: number;
  /** Staged-but-not-yet-saved (propose mode): removable, highlighted. */
  pending?: boolean;
  /** Already-saved option shown read-only during propose mode. */
  locked?: boolean;
}

interface Props {
  slots: MonthSlot[];
  /** When true, tapping an empty day proposes/adds it as a candidate. */
  addMode: boolean;
  onDayAdd?: (startsAt: number) => void;
  /** Tapping an existing candidate day. */
  onSlotClick?: (slot: MonthSlot) => void;
  initialDate?: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthCalendar({ slots, addMode, onDayAdd, onSlotClick, initialDate }: Props) {
  const [cursor, setCursor] = useState<Date>(() =>
    initialDate ? new Date(initialDate) : new Date(),
  );
  const days = useMemo(() => monthDays(cursor), [cursor]);
  const now = new Date();

  return (
    <div className="cal month">
      <div className="cal-nav">
        <div className="cal-nav-buttons">
          <button type="button" onClick={() => setCursor(new Date())}>
            Today
          </button>
          <button type="button" aria-label="Previous month" onClick={() => setCursor((c) => shiftMonth(c, -1))}>
            ‹
          </button>
          <button type="button" aria-label="Next month" onClick={() => setCursor((c) => shiftMonth(c, 1))}>
            ›
          </button>
        </div>
        <div className="cal-range">{format(cursor, "MMMM yyyy")}</div>
      </div>

      <div className="month-weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="month-weekday">
            {w}
          </div>
        ))}
      </div>

      <div className="month-grid">
        {days.map((day) => {
          const inMonth = isSameMonth(day, cursor);
          const isToday = isSameDay(day, now);
          const slot = slots.find((s) => isSameDay(new Date(s.startsAt), day));
          const isOption = !!slot;
          const locked = !!slot?.locked;
          const pending = !!slot?.pending;
          // Spill-over days (other months) are still fully clickable — only their
          // styling is muted, so you can pick e.g. the 1st of next month directly.
          const canAdd = addMode && !isOption;
          const clickable = (isOption && !locked) || canAdd;

          const fill = !isOption
            ? ""
            : pending
              ? " pending"
              : locked
                ? " locked"
                : slot!.myChoice === "yes"
                  ? " choice-yes"
                  : slot!.myChoice === "maybe"
                    ? " choice-maybe"
                    : " choice-none";

          const classes =
            "month-cell" +
            (inMonth ? "" : " muted-day") +
            (isToday ? " is-today" : "") +
            (isOption ? " opt" : "") +
            fill +
            (slot?.leading ? " leading" : "") +
            (canAdd ? " addable" : "") +
            (clickable ? " clickable" : "");

          return (
            <div
              key={day.toISOString()}
              className={classes}
              onClick={() => {
                if (isOption && slot && !locked) onSlotClick?.(slot);
                else if (canAdd) onDayAdd?.(timestampFor(day, 0));
              }}
            >
              <span className="month-date">{format(day, "d")}</span>
              {slot?.leading && (
                <span className="month-star" title="Most popular so far">
                  ★
                </span>
              )}
              {isOption && slot!.count !== undefined && slot!.count > 0 && (
                <span className="month-count">{slot!.count}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
