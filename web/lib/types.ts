export type Color = "white" | "green" | "pink" | "brown";
export type Band = "low-mid" | "mid" | "high" | "broad";
export type Motion = "still" | "drift" | "breathing";
export type Balance = "bed-forward" | "balanced" | "texture-forward";

export type Variant = {
  variantId: string;
  filename: string;
  matrixIndex: number;
  color: Color;
  band: Band;
  motion: Motion;
  balance: Balance;
  bandLowHz: number;
  bandHighHz: number;
  lfoDepth: number;
  lfoRateHz: number;
  gainsDb: { bed: number; motion: number; texture: number };
  seeds: Record<string, number>;
  durationSeconds: number;
  sampleRate: number;
  targetLufs: number;
  truePeakMaxDbtp: number;
  pilot: string | null;
  spectrum: {
    tiltDbPerOct: number;
    bell: { gainDb: number; centerHz: number; q: number } | null;
  };
};

export type QaCheck = {
  name: string;
  measured: string;
  threshold: string;
  passed: boolean;
};

export type LibraryTrack = Variant & {
  path: string;
  audioUrl: string;
  downloadUrl: string;
  exists: boolean;
  qaVerdict: "PASS" | "FAIL" | "UNAVAILABLE";
  qaChecks: QaCheck[];
  measuredLufs: string | null;
  measuredTruePeak: string | null;
  renderStatus: string;
  title?: string;
  description?: string;
  titleApproved?: boolean;
};

export type QueueJob = {
  id: string;
  variantId: string;
  status: "Queued" | "Rendering" | "Done" | "Failed";
  queuedAt: string;
  error?: string;
};
