import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, startOfDay } from "date-fns";
import {
  HOUR_HEIGHT,
  DAY_HEIGHT,
  SNAP_MINUTES,
  weekStart,
  weekDays,
  minutesIntoDay,
  timestampFor,
  formatHourLabel,
  isSameDay,
  format,
} from "./calendar";

export interface CalSlot {
  id: string;
  startsAt: number;
  label?: string;
  tone?: "neutral" | "leader" | "me";
}

interface Props {
  durationMinutes: number;
  slots: CalSlot[];
  addable: boolean;
  onAdd?: (startsAt: number) => void;
  onSlotClick?: (slot: CalSlot) => void;
  activeSlotId?: string | null;
  initialDate?: number;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const SWIPE_THRESHOLD = 45; // px of horizontal travel before it counts as a swipe

/** True on phone-width screens, where we drop from a 7-day to a 3-day view. */
function useIsNarrow(): boolean {
  const query = "(max-width: 560px)";
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = () => setNarrow(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return narrow;
}

export function WeekCalendar(props: Props) {
  const { durationMinutes, slots, addable, onAdd, onSlotClick, activeSlotId } = props;

  const narrow = useIsNarrow();
  const visibleCount = narrow ? 3 : 7;

  // `anchor` is a reference day. On mobile it's the first visible day; on desktop
  // it's normalised to the Monday-aligned week that contains it.
  const [anchor, setAnchor] = useState<Date>(() =>
    startOfDay(props.initialDate ? new Date(props.initialDate) : new Date()),
  );

  // Bumping `animKey` remounts the grid so the slide animation replays on every move.
  const [anim, setAnim] = useState<"" | "next" | "prev">("");
  const [animKey, setAnimKey] = useState(0);

  const days = useMemo(() => {
    if (narrow) {
      const first = startOfDay(anchor);
      return Array.from({ length: visibleCount }, (_, i) => addDays(first, i));
    }
    return weekDays(weekStart(anchor));
  }, [anchor, narrow, visibleCount]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_HEIGHT;
  }, []);

  const now = new Date();
  const gridCols = `44px repeat(${days.length}, 1fr)`;

  const windowStart = startOfDay(days[0]!).getTime();
  const windowEnd = addDays(startOfDay(days[days.length - 1]!), 1).getTime();

  // "Skip to the next/previous proposed option" relative to what's on screen.
  const sortedStarts = useMemo(() => slots.map((s) => s.startsAt).sort((a, b) => a - b), [slots]);
  const nextOption = sortedStarts.find((ts) => ts >= windowEnd);
  const prevOption = [...sortedStarts].reverse().find((ts) => ts < windowStart);

  function navigate(updater: (a: Date) => Date, dir: "next" | "prev") {
    setAnchor(updater);
    setAnim(dir);
    setAnimKey((k) => k + 1);
  }
  function step(dir: "next" | "prev") {
    navigate((a) => addDays(a, (dir === "next" ? 1 : -1) * visibleCount), dir);
  }
  function jump(ts: number) {
    navigate(() => startOfDay(new Date(ts)), ts >= windowEnd ? "next" : "prev");
  }
  function goToday() {
    const t = startOfDay(new Date());
    navigate(() => t, t.getTime() < windowStart ? "prev" : "next");
  }

  // Horizontal swipe → previous / next, without hijacking vertical scroll.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]!;
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const t = e.changedTouches[0]!;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.4) {
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 350);
      step(dx < 0 ? "next" : "prev");
    }
  }

  function rangeLabel() {
    const first = days[0]!;
    const last = days[days.length - 1]!;
    const sameMonth = first.getMonth() === last.getMonth();
    return sameMonth
      ? `${format(first, "d")}–${format(last, "d MMM yyyy")}`
      : `${format(first, "d MMM")} – ${format(last, "d MMM yyyy")}`;
  }

  function handleColumnClick(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    if (suppressClick.current) return; // a swipe just happened
    if (!addable || !onAdd) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rawMinutes = (y / HOUR_HEIGHT) * 60;
    let minutes = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
    minutes = Math.max(0, Math.min(minutes, 24 * 60 - durationMinutes));
    onAdd(timestampFor(day, minutes));
  }

  const nav = (
    <div className="cal-nav">
      <div className="cal-nav-left">
        <div className="cal-nav-buttons">
          <button type="button" onClick={goToday}>
            Today
          </button>
          <button type="button" aria-label="Previous" onClick={() => step("prev")}>
            ‹
          </button>
          <button type="button" aria-label="Next" onClick={() => step("next")}>
            ›
          </button>
        </div>
        <div className="cal-range">{rangeLabel()}</div>
      </div>
      <div className="cal-jump">
        <button
          type="button"
          disabled={prevOption === undefined}
          title="Jump to the previous proposed option"
          onClick={() => prevOption !== undefined && jump(prevOption)}
        >
          ‹ option
        </button>
        <button
          type="button"
          disabled={nextOption === undefined}
          title="Jump to the next proposed option"
          onClick={() => nextOption !== undefined && jump(nextOption)}
        >
          option ›
        </button>
      </div>
    </div>
  );

  return (
    <div className="cal" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {nav}
      <div className="cal-head" style={{ gridTemplateColumns: gridCols }}>
        <div className="cal-gutter-head" />
        {days.map((day) => (
          <div key={day.toISOString()} className={`cal-day-head${isSameDay(day, now) ? " is-today" : ""}`}>
            <span className="dow">{format(day, "EEE")}</span>
            <span className="dnum">{format(day, "d")}</span>
          </div>
        ))}
      </div>

      <div className="cal-body" ref={scrollRef}>
        <div
          key={animKey}
          className={`cal-grid${anim ? ` anim-${anim}` : ""}`}
          style={{ height: DAY_HEIGHT, gridTemplateColumns: gridCols }}
        >
          <div className="cal-gutter">
            {HOURS.map((h) => (
              <div key={h} className="cal-hour-label" style={{ top: h * HOUR_HEIGHT }}>
                {formatHourLabel(h)}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const daySlots = slots.filter((s) => isSameDay(new Date(s.startsAt), day));
            const showNow = isSameDay(day, now);
            return (
              <div
                key={day.toISOString()}
                className={`cal-col${addable ? " addable" : ""}`}
                onClick={(e) => handleColumnClick(day, e)}
              >
                {HOURS.map((h) => (
                  <div key={h} className="cal-hour-line" style={{ top: h * HOUR_HEIGHT }} />
                ))}

                {showNow && (
                  <div
                    className="cal-now"
                    style={{ top: (minutesIntoDay(now.getTime()) / 60) * HOUR_HEIGHT }}
                  />
                )}

                {daySlots.map((s) => {
                  const top = (minutesIntoDay(s.startsAt) / 60) * HOUR_HEIGHT;
                  const height = Math.max(18, (durationMinutes / 60) * HOUR_HEIGHT);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      className={`cal-slot tone-${s.tone ?? "neutral"}${s.id === activeSlotId ? " active" : ""}`}
                      style={{ top, height }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSlotClick?.(s);
                      }}
                    >
                      <span className="cal-slot-time">{format(new Date(s.startsAt), "HH:mm")}</span>
                      {s.label && <span className="cal-slot-label">{s.label}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
