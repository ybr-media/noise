"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TUTORIAL_STORAGE_KEY,
  TUTORIAL_VERSION,
  tutorialDoneFromStorage,
  tutorialDoneStorageValue,
  type TutorialUserRecord,
} from "@/lib/tutorial";

export type FirstRunState = {
  ready: boolean;
  authenticated: boolean;
  firstPaintGuard: boolean;
  user: TutorialUserRecord | null;
};

const UNKNOWN_STATE: FirstRunState = { ready: false, authenticated: false, firstPaintGuard: false, user: null };

export function completedFirstRunState(state: FirstRunState, completedAt: string): FirstRunState {
  const user = state.user ?? { email: "", tutorialCompletedAt: null, tutorialVersion: TUTORIAL_VERSION };
  return { ...state, user: { ...user, tutorialCompletedAt: completedAt } };
}

export function firstRunShouldLaunch(state: FirstRunState): boolean {
  return state.ready && state.authenticated && !state.firstPaintGuard && !state.user?.tutorialCompletedAt;
}

export function useFirstRun(authConfigured: boolean) {
  const [state, setState] = useState<FirstRunState>(UNKNOWN_STATE);

  useEffect(() => {
    let cancelled = false;
    if (!authConfigured) {
      setState({ ready: true, authenticated: false, firstPaintGuard: false, user: null });
      return () => { cancelled = true; };
    }

    const localDone = tutorialDoneFromStorage(localStorage.getItem(TUTORIAL_STORAGE_KEY));
    if (localDone) setState((previous) => ({ ...previous, firstPaintGuard: true }));

    fetch("/api/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`First-run lookup failed (${response.status})`);
        return response.json() as Promise<TutorialUserRecord>;
      })
      .then((user) => {
        if (cancelled) return;
        const storageValue = tutorialDoneStorageValue(user.tutorialCompletedAt);
        if (storageValue) localStorage.setItem(TUTORIAL_STORAGE_KEY, storageValue);
        else localStorage.removeItem(TUTORIAL_STORAGE_KEY);
        setState({ ready: true, authenticated: true, firstPaintGuard: false, user });
      })
      .catch(() => {
        if (!cancelled) setState({ ready: true, authenticated: false, firstPaintGuard: false, user: null });
      });

    return () => { cancelled = true; };
  }, [authConfigured]);

  const markCompleted = useCallback(() => {
    const completedAt = new Date().toISOString();
    const storageValue = tutorialDoneStorageValue(completedAt);
    if (storageValue) localStorage.setItem(TUTORIAL_STORAGE_KEY, storageValue);
    setState((previous) => completedFirstRunState(previous, completedAt));
  }, []);

  return {
    ...state,
    completed: Boolean(state.user?.tutorialCompletedAt),
    shouldLaunch: firstRunShouldLaunch(state),
    markCompleted,
  };
}
