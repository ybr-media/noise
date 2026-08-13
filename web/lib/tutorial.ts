export const TUTORIAL_VERSION = 1;
export const TUTORIAL_STORAGE_KEY = "noise.tutorial.done";
export type TutorialApiAccess = "open" | "unauthenticated" | "authenticated";

export type TutorialUserRecord = {
  email: string;
  tutorialCompletedAt: string | null;
  tutorialVersion: number;
};

type StoredTutorialUser = Partial<TutorialUserRecord> & { email?: string | null };

export function tutorialApiAccess(authConfigured: boolean, email: string | null): TutorialApiAccess {
  if (!authConfigured) return "open";
  return email ? "authenticated" : "unauthenticated";
}

export function tutorialUserResponse(user: StoredTutorialUser, email: string): TutorialUserRecord {
  return {
    email,
    tutorialCompletedAt: typeof user.tutorialCompletedAt === "string" ? user.tutorialCompletedAt : null,
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
