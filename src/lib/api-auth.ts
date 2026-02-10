import { NextRequest } from "next/server";

export interface ApiUser {
  id: number;
  type: "team" | "supervisor" | "admin";
  name: string;
  eventId: number;
}

export function getApiUser(request: NextRequest): ApiUser | null {
  const id = request.headers.get("x-user-id");
  const type = request.headers.get("x-user-type") as ApiUser["type"];
  const name = request.headers.get("x-user-name");
  const eventId = request.headers.get("x-event-id");

  if (!id || !type || !name || !eventId) return null;

  return {
    id: Number(id),
    type,
    name: name || "",
    eventId: Number(eventId),
  };
}
