/**
 * Per-tab identity, so a refresh keeps your place. Nothing here is a secret the server
 * trusts on its own: the ids are unguessable and the server still checks every action.
 */

export interface TASession {
  studentCode: string;
  taId: string;
  name: string;
  isHost: boolean;
}

export interface StudentSession {
  studentCode: string;
  studentId: string;
}

const read = <T>(key: string): T | null => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private browsing: the session simply will not survive a refresh */
  }
};

const clear = (key: string) => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

export const taSession = {
  get: (studentCode: string) => {
    const s = read<TASession>("ta-queue:ta");
    return s?.studentCode === studentCode ? s : null;
  },
  set: (s: TASession) => write("ta-queue:ta", s),
  clear: () => clear("ta-queue:ta"),
};

export const studentSession = {
  get: (studentCode: string) => {
    const s = read<StudentSession>("ta-queue:student");
    return s?.studentCode === studentCode ? s : null;
  },
  set: (s: StudentSession) => write("ta-queue:student", s),
  clear: () => clear("ta-queue:student"),
};

/** Remembers the name you last used, so a TA rejoining does not retype it. */
export const lastName = {
  get: () => {
    try {
      return localStorage.getItem("ta-queue:name") ?? "";
    } catch {
      return "";
    }
  },
  set: (name: string) => {
    try {
      localStorage.setItem("ta-queue:name", name);
    } catch {
      /* ignore */
    }
  },
};
