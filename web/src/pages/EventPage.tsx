import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MonthCalendar, type MonthSlot } from "../MonthCalendar";
import { api } from "../api";
import {
  getSavedName,
  setSavedName,
  getAdminToken,
  clearAdminToken,
} from "../storage";
import { formatSlotDay } from "../calendar";
import type { EventData, EventDetail, SlotData, VoteChoice } from "../types";

function tally(slot: SlotData) {
  let yes = 0,
    maybe = 0;
  for (const v of slot.votes) {
    if (v.choice === "yes") yes++;
    else if (v.choice === "maybe") maybe++;
  }
  return { yes, maybe };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Stable colour per name, so the same person looks the same on every option. */
function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** A thin two-tone bar: green = yes, amber = maybe, scaled to the whole group. */
function Meter({ yes, maybe, total }: { yes: number; maybe: number; total: number }) {
  if (total === 0) return null;
  return (
    <div className="meter" title={`${yes} yes · ${maybe} maybe · of ${total}`}>
      <span className="seg-yes" style={{ width: `${(yes / total) * 100}%` }} />
      <span className="seg-maybe" style={{ width: `${(maybe / total) * 100}%` }} />
    </div>
  );
}

/** Overlapping initials circles: filled = yes, outlined = maybe. */
function Avatars({ yes, maybe }: { yes: string[]; maybe: string[] }) {
  const items = [
    ...yes.map((n) => ({ n, kind: "yes" as const })),
    ...maybe.map((n) => ({ n, kind: "maybe" as const })),
  ];
  if (items.length === 0) return <span className="avatars-empty">—</span>;
  const shown = items.slice(0, 5);
  const extra = items.length - shown.length;
  return (
    <div className="avatars">
      {shown.map((it, i) => {
        const color = `hsl(${hueFor(it.n)} 52% 42%)`;
        return (
          <span
            key={it.n + i}
            className={`avatar ${it.kind}`}
            title={it.kind === "maybe" ? `${it.n} (maybe)` : it.n}
            style={
              it.kind === "yes"
                ? { background: color, color: "#fff" }
                : { background: "#fff", color, boxShadow: `inset 0 0 0 2px ${color}` }
            }
          >
            {initials(it.n)}
          </span>
        );
      })}
      {extra > 0 && <span className="avatar more">+{extra}</span>}
    </div>
  );
}

/** Merge one person's votes into a detail snapshot so the UI updates instantly on click. */
function mergeMyVotes(
  detail: EventDetail,
  name: string,
  votes: Record<string, VoteChoice>,
): EventDetail {
  return {
    ...detail,
    slots: detail.slots.map((s) => {
      const others = s.votes.filter((v) => v.voterName !== name);
      const mine = votes[s.id];
      return { ...s, votes: mine ? [...others, { voterName: name, choice: mine }] : others };
    }),
  };
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function EventPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [committedName, setCommittedName] = useState(getSavedName());
  const [myVotes, setMyVotes] = useState<Record<string, VoteChoice>>({});
  const [proposing, setProposing] = useState(false);
  const [pending, setPending] = useState<number[]>([]); // staged days, not yet published
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveTimer = useRef<number | undefined>(undefined);

  const adminToken = getAdminToken(id);
  const isAdmin = !!adminToken;
  const name = committedName.trim();

  const load = useCallback(async () => {
    try {
      const d = await api.getEvent(id);
      setDetail(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load event");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Derive this person's existing votes whenever the data or their name changes.
  useEffect(() => {
    if (!detail) return;
    const next: Record<string, VoteChoice> = {};
    if (name) {
      for (const s of detail.slots) {
        const mine = s.votes.find((v) => v.voterName === name);
        if (mine) next[s.id] = mine.choice;
      }
    }
    setMyVotes(next);
  }, [detail, name]);

  const leaderIds = useMemo(() => {
    if (!detail || detail.slots.length === 0) return new Set<string>();
    let best = -1;
    let bestTie = -1;
    for (const s of detail.slots) {
      const t = tally(s);
      if (t.yes > best || (t.yes === best && t.yes + t.maybe > bestTie)) {
        best = t.yes;
        bestTie = t.yes + t.maybe;
      }
    }
    const ids = new Set<string>();
    if (best > 0) {
      for (const s of detail.slots) {
        const t = tally(s);
        if (t.yes === best && t.yes + t.maybe === bestTie) ids.add(s.id);
      }
    }
    return ids;
  }, [detail]);

  function flashMsg(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  }

  // Auto-save: debounced so rapid clicks collapse into one request. Each save is a
  // full replacement of this person's votes, so the latest map always wins.
  function scheduleSave(votes: Record<string, VoteChoice>) {
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        setSavedName(name);
        await api.saveVotes(id, name, votes);
        setSaveState("saved");
        window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1500);
      } catch (e) {
        setSaveState("error");
        flashMsg(e instanceof Error ? e.message : "Could not save");
        void load(); // resync from server on failure
      }
    }, 450);
  }

  function commitVotes(next: Record<string, VoteChoice>) {
    setMyVotes(next);
    setDetail((d) => (d ? mergeMyVotes(d, name, next) : d)); // instant UI update
    scheduleSave(next);
  }

  // Tapping a day on the month calendar steps through none → yes → maybe → none.
  const VOTE_CYCLE: (VoteChoice | undefined)[] = [undefined, "yes", "maybe"];
  function cycleVote(slotId: string) {
    const current = myVotes[slotId];
    const nextChoice = VOTE_CYCLE[(VOTE_CYCLE.indexOf(current) + 1) % VOTE_CYCLE.length];
    const next = { ...myVotes };
    if (nextChoice) next[slotId] = nextChoice;
    else delete next[slotId];
    commitVotes(next);
  }

  function startProposing() {
    setPending([]);
    setProposing(true);
  }

  // Stage a new day locally — nothing is saved until "Done".
  function stagePending(startsAt: number) {
    setPending((prev) => {
      if (prev.includes(startsAt)) return prev;
      if (detail?.slots.some((s) => s.startsAt === startsAt)) return prev; // already an option
      return [...prev, startsAt].sort((a, b) => a - b);
    });
  }
  function unstagePending(startsAt: number) {
    setPending((prev) => prev.filter((ts) => ts !== startsAt));
  }

  // "Done" — publish every staged day, then leave propose mode.
  async function publishProposals() {
    if (pending.length === 0) {
      setProposing(false);
      return;
    }
    setBusy(true);
    try {
      setSavedName(name);
      await api.addSlots(id, pending, name, adminToken ?? undefined); // atomic
      await load();
      setPending([]);
      setProposing(false);
    } catch (e) {
      flashMsg(e instanceof Error ? e.message : "Could not publish your dates");
    } finally {
      setBusy(false);
    }
  }

  async function removeSlot(slot: SlotData) {
    if (!confirm("Remove this option for everyone?")) return;
    setBusy(true);
    try {
      await api.deleteSlot(id, slot.id, name, adminToken ?? undefined);
      await load();
    } catch (e) {
      flashMsg(e instanceof Error ? e.message : "Could not remove");
    } finally {
      setBusy(false);
    }
  }

  async function deleteEvent() {
    if (!adminToken) return;
    if (!confirm("Delete this whole event? This cannot be undone.")) return;
    try {
      await api.deleteEvent(id, adminToken);
      clearAdminToken(id);
      navigate("/");
    } catch (e) {
      flashMsg(e instanceof Error ? e.message : "Could not delete");
    }
  }

  function share() {
    const url = window.location.href;
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => flashMsg(url),
    );
  }

  if (loading) return <CenterMsg>Loading…</CenterMsg>;
  if (error || !detail) return <CenterMsg>{error ?? "Event not found"}</CenterMsg>;

  const { event, slots } = detail;

  // Gate: you must say who you are before you can see and vote on the options.
  if (!name) {
    return (
      <NameGate
        event={event}
        initial={getSavedName()}
        onSubmit={(n) => {
          setSavedName(n);
          setCommittedName(n);
        }}
      />
    );
  }

  const canPropose = event.allowProposals || isAdmin;

  const allVoters = new Set<string>();
  for (const s of slots) for (const v of s.votes) allVoters.add(v.voterName);
  const voterCount = allVoters.size;

  const monthSlots: MonthSlot[] = proposing
    ? [
        // existing options are locked (read-only) while you stage new ones
        ...slots.map((s) => ({ id: s.id, startsAt: s.startsAt, locked: true })),
        ...pending.map((ts) => ({ id: `pending-${ts}`, startsAt: ts, pending: true })),
      ]
    : slots.map((s) => ({
        id: s.id,
        startsAt: s.startsAt,
        myChoice: myVotes[s.id],
        leading: leaderIds.has(s.id),
        count: tally(s).yes,
      }));

  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" href="/">Booker</a>
        <button type="button" className="share" onClick={share}>
          {copied ? "Link copied ✓" : "Copy share link"}
        </button>
      </header>

      <main className="container">
        <div className="event-head">
          <h1>{event.name}</h1>
          <p className="muted">
            All day · organised by {event.createdBy}
            {isAdmin && " · you created this"}
          </p>
          <p className="voting-as">
            Voting as <strong>{name}</strong>
          </p>
          {isAdmin && (
            <p className="share-hint">
              One link for everyone — share this page and each friend just enters their own name to
              vote. Nothing in the link identifies you, so it's safe to send to the whole group.
            </p>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <h2>{proposing ? "Add new days" : "The options"}</h2>
            {canPropose && (
              <button
                type="button"
                className={`chip${proposing ? " selected" : ""}`}
                onClick={() => (proposing ? publishProposals() : startProposing())}
                disabled={busy}
              >
                {proposing
                  ? busy
                    ? "Publishing…"
                    : `Done${pending.length ? ` (${pending.length})` : ""}`
                  : "Propose a day"}
              </button>
            )}
          </div>
          {proposing && (
            <p className="muted">
              Tap empty days to add them, tap a new (blue) day to undo. Existing days are locked.
              Press <strong>Done</strong> to publish.
            </p>
          )}

          <MonthCalendar
            slots={monthSlots}
            addMode={proposing}
            onDayAdd={proposing ? stagePending : undefined}
            onSlotClick={proposing ? (s) => unstagePending(s.startsAt) : (s) => cycleVote(s.id)}
            initialDate={slots[0]?.startsAt}
          />
          {!proposing && slots.length > 0 && (
            <div className="vote-legend">
              <span>Tap a day to vote —</span>
              <span className="lg v-yes">Yes</span>
              <span className="lg v-maybe">Maybe</span>
              <span className="lg-leading">
                <span className="star">★</span> most popular
              </span>
            </div>
          )}
        </div>

        {!proposing && (
        <div className="card">
          <div className="card-title">
            <h2>Your availability</h2>
            <span className="status-line">
              {flash && <span className="flash">{flash}</span>}
              {saveState === "saving" && <span className="save-state">Saving…</span>}
              {saveState === "saved" && <span className="save-state saved">Saved ✓</span>}
              {saveState === "error" && <span className="save-state error">Save failed</span>}
            </span>
          </div>
          <p className="muted">
            Tap days on the calendar above — your answer saves automatically.
          </p>

          {slots.length === 0 ? (
            <p className="muted">No options yet{canPropose ? " — propose one above." : "."}</p>
          ) : (
            <ul className="slot-list">
              {slots.map((s) => {
                const t = tally(s);
                const mine = myVotes[s.id];
                const yesNames = s.votes.filter((v) => v.choice === "yes").map((v) => v.voterName);
                const maybeNames = s.votes.filter((v) => v.choice === "maybe").map((v) => v.voterName);
                const canRemove = isAdmin || name === s.createdBy;
                const isLeader = leaderIds.has(s.id);
                return (
                  <li key={s.id} className={`slot-row${isLeader ? " leader" : ""}`}>
                    <div className="slot-main">
                      <div className="slot-when">
                        {isLeader && (
                          <span className="lead-star" title="Most popular so far">
                            ★
                          </span>
                        )}
                        <strong>{formatSlotDay(s.startsAt)}</strong>
                        <span className="muted">All day</span>
                      </div>
                      <div className="slot-meter">
                        {voterCount === 0 ? (
                          <span className="slot-count muted">No votes yet</span>
                        ) : (
                          <>
                            <Meter yes={t.yes} maybe={t.maybe} total={voterCount} />
                            <span className="slot-count muted">
                              {t.yes} in{t.maybe > 0 && ` · ${t.maybe} maybe`}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="slot-side">
                      <Avatars yes={yesNames} maybe={maybeNames} />

                      {mine && (
                        <span className={`you-chip v-${mine}`}>{mine === "yes" ? "Yes" : "Maybe"}</span>
                      )}

                      {canRemove && (
                        <button
                          type="button"
                          className="row-remove"
                          title="Remove this option"
                          onClick={() => removeSlot(s)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        )}

        {!proposing && isAdmin && (
          <div className="card danger-zone">
            <div className="card-title">
              <h2>Organiser</h2>
            </div>
            <p className="muted">You created this event, so only you can delete it.</p>
            <button type="button" className="link-danger" onClick={deleteEvent} disabled={busy}>
              Delete event
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function NameGate({
  event,
  initial,
  onSubmit,
}: {
  event: EventData;
  initial: string;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();

  function submit() {
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" href="/">Booker</a>
      </header>
      <main className="container">
        <div className="card gate">
          <p className="muted">You've been invited to vote on</p>
          <h1>{event.name}</h1>
          <p className="muted">All day · organised by {event.createdBy}</p>
          <label className="field gate-field">
            <span>What's your name?</span>
            <input
              type="text"
              autoFocus
              placeholder="This is how everyone will know it's you"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>
          <button type="button" className="primary" onClick={submit} disabled={!trimmed}>
            Continue
          </button>
        </div>
      </main>
    </div>
  );
}

function CenterMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" href="/">Booker</a>
      </header>
      <div className="center-msg">{children}</div>
    </div>
  );
}
