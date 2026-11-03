import { normalizeMembers } from "@/lib/utils";

export function parseMembers(members: string | null): string[] {
  return normalizeMembers(members);
}

export interface TeamInfo {
  id: number;
  name: string;
  members: string | null;
  assignedItems: number;
  pinPlain?: string | null;
}

export interface SupervisorInfo {
  id: number;
  name: string;
  role: string;
  pinPlain?: string | null;
}

export interface EventOption {
  id: number;
  name: string;
  status: string;
}
