import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MonthCalendar, type MonthSlot } from "../MonthCalendar";
import { api } from "../api";
import { getSavedName, setSavedName, setAdminToken } from "../storage";

interface Draft {
  id: string;
  startsAt: number;
}

export function CreatePage() {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [createdBy, setCreatedBy] = useState(getSavedName());
  const [allowProposals, setAllowProposals] = useState(true);
  const [slots, setSlots] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const monthSlots: MonthSlot[] = slots.map((s) => ({ id: s.id, startsAt: s.startsAt }));

  function addSlot(startsAt: number) {
    if (slots.some((s) => s.startsAt === startsAt)) return; // avoid duplicate days
    setSlots((prev) =>
      [...prev, { id: crypto.randomUUID(), startsAt }].sort((a, b) => a.startsAt - b.startsAt),
    );
  }

  function removeSlot(id: string) {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  }

  async function submit() {
    setError(null);
    const trimmedName = name.trim();
    const trimmedBy = createdBy.trim();
    if (!trimmedName) return setError("Give your event a name.");
    if (!trimmedBy) return setError("Add your name so people know who's organising.");
    if (slots.length === 0 && !allowProposals) {
      return setError("Add at least one day, or let your friends propose dates.");
    }

    setSubmitting(true);
    try {
      const res = await api.createEvent({
        name: trimmedName,
        allowProposals,
        createdBy: trimmedBy,
        slots: slots.map((s) => s.startsAt),
      });
      setSavedName(trimmedBy);
      setAdminToken(res.id, res.adminToken);
      navigate(`/e/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" href="/">Booker</a>
        <span className="tagline">agree on a date, no nonsense</span>
      </header>

      <main className="container">
        <div className="card form">
          <label className="field">
            <input
              type="text"
              aria-label="Event name"
              placeholder="Event name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="field">
            <input
              type="text"
              aria-label="Your name"
              placeholder="Your name"
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
            />
          </label>

          <label className="switch standalone">
            <input
              type="checkbox"
              checked={allowProposals}
              onChange={(e) => setAllowProposals(e.target.checked)}
            />
            <span>Let friends propose their own dates too</span>
          </label>
        </div>

        <div className="card">
          <div className="card-title">
            <h2>Pick some days</h2>
          </div>
          <p className="muted">Click a day to offer it as an option. Click it again to remove it.</p>

          <MonthCalendar
            slots={monthSlots}
            addMode
            onDayAdd={addSlot}
            onSlotClick={(s) => removeSlot(s.id)}
          />
        </div>

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <button type="button" className="primary" onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create event & get link"}
          </button>
        </div>
      </main>
    </div>
  );
}
