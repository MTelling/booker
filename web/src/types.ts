// Mirrors the API shapes in ../../src/types.ts (kept in sync by hand — they are tiny).
export type VoteChoice = "yes" | "maybe";

export interface EventData {
  id: string;
  name: string;
  durationMinutes: number;
  allDay: boolean;
  allowProposals: boolean;
  createdBy: string;
  createdAt: number;
}

export interface SlotVote {
  voterName: string;
  choice: VoteChoice;
}

export interface SlotData {
  id: string;
  startsAt: number;
  createdBy: string;
  votes: SlotVote[];
}

export interface EventDetail {
  event: EventData;
  slots: SlotData[];
}
