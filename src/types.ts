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

export interface CreateEventInput {
  name: string;
  allowProposals: boolean;
  createdBy: string;
  slots: number[];
}
