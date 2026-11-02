export function parseMembers(members: string | null): string[] {
  if (!members) return [];
  try { return JSON.parse(members) as string[]; } catch { return []; }
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
