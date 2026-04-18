import { v4 as uuidv4 } from "uuid";

export interface Session {
  id: string;
  startedAt: string;
}

export function newSession(idOverride?: string): Session {
  return {
    id: idOverride ?? uuidv4(),
    startedAt: new Date().toISOString(),
  };
}
