import { isDate } from "@auth/core/adapters";

export const TUTORIAL_VERSION = 1;
export const TUTORIAL_STORAGE_KEY = "noise.tutorial.done";
export type TutorialApiAccess = "open" | "unauthenticated" | "authenticated";

export type TutorialUserRecord = {
  email: string;
  tutorialCompletedAt: string | null;
  tutorialVersion: number;
};

type StoredTutorialUser = Omit<Partial<TutorialUserRecord>, "tutorialCompletedAt"> & {
  email?: string | null;
  tutorialCompletedAt?: unknown;
};

function normalizeTutorialCompletedAt(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return isDate(value) ? value : null;
}

export function tutorialApiAccess(authConfigured: boolean, email: string | null): TutorialApiAccess {
  if (!authConfigured) return "open";
  return email ? "authenticated" : "unauthenticated";
}

export function tutorialUserResponse(user: StoredTutorialUser, email: string): TutorialUserRecord {
  return {
    email,
    tutorialCompletedAt: normalizeTutorialCompletedAt(user.tutorialCompletedAt),
    tutorialVersion: typeof user.tutorialVersion === "number" ? user.tutorialVersion : TUTORIAL_VERSION,
  };
}

export function markTutorialComplete(user: StoredTutorialUser, completedAt: string): TutorialUserRecord {
  return {
    ...tutorialUserResponse(user, user.email ?? ""),
    tutorialCompletedAt: completedAt,
    tutorialVersion: TUTORIAL_VERSION,
  };
}

export function tutorialDoneFromStorage(value: string | null): boolean {
  return value === "1";
}

export function tutorialDoneStorageValue(completedAt: string | null): string | null {
  return completedAt ? "1" : null;
}
