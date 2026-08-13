"use client";

import { useEffect, useState } from "react";
import {
  TUTORIAL_STORAGE_KEY,
  TUTORIAL_VERSION,
  tutorialDoneFromStorage,
  tutorialDoneStorageValue,
  type TutorialUserRecord,
} from "@/lib/tutorial";

type FirstRunState = {
  ready: boolean;
  authenticated: boolean;
  user: TutorialUserRecord | null;
};

const UNKNOWN_STATE: FirstRunState = { ready: false, authenticated: false, user: null };

export function useFirstRun(authConfigured: boolean) {
  const [state, setState] = useState<FirstRunState>(UNKNOWN_STATE);

  useEffect(() => {
    let cancelled = false;
    if (!authConfigured) {
      setState({ ready: true, authenticated: false, user: null });
      return () => { cancelled = true; };
    }

    const localDone = tutorialDoneFromStorage(localStorage.getItem(TUTORIAL_STORAGE_KEY));
    if (localDone) {
      setState((previous) => ({
        ...previous,
        user: previous.user ?? {
          email: "",
          tutorialCompletedAt: "local-storage-guard",
          tutorialVersion: TUTORIAL_VERSION,
        },
      }));
    }

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
        setState({ ready: true, authenticated: true, user });
      })
      .catch(() => {
        if (!cancelled) setState({ ready: true, authenticated: false, user: null });
      });

    return () => { cancelled = true; };
  }, [authConfigured]);

  return {
    ...state,
    completed: Boolean(state.user?.tutorialCompletedAt),
    shouldLaunch: state.ready && state.authenticated && !state.user?.tutorialCompletedAt,
  };
}
