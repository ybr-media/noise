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
  cellSeconds: number;
  repeats: number;
  fadeSeconds?: number;
  bitDepth?: number;
};

export type QaCheck = {
  name: string;
  measured: string;
  threshold: string;
  passed: boolean;
};

// One of the three source stems a master was mixed from, in stem_1..stem_3
// order. Stems are downloadable assets, not library tracks of their own.
export type TrackStem = {
  filename: string;
  sizeBytes: number;
  number: number;
  stem: string;
  audioUrl: string;
  downloadUrl: string;
  exists: boolean;
};

export type LibraryRecipe = {
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
  tiltDbPerOct: number;
  bell: { gainDb: number; centerHz: number; q: number } | null;
  eq: import("./fx").FxBlock["eq"] | null;
  reverb: import("./fx").FxBlock["reverb"] | null;
  fxRecorded: boolean;
  cellSeconds: number;
  repeats: number;
  fadeSeconds: number | null;
  sampleRate: number;
  bitDepth: number | null;
  targetLufs: number;
  truePeakMaxDbtp: number;
  tailSeconds: number | null;
  audacityVersion: string | null;
  renderedAt: string | null;
};

export type LibraryTrack = Variant & {
  demo?: boolean;
  renderKey: string;
  path: string;
  sizeBytes: number;
  audioUrl: string;
  downloadUrl: string;
  exists: boolean;
  stems: TrackStem[];
  qaVerdict: "PASS" | "FAIL" | "UNAVAILABLE";
  qaChecks: QaCheck[];
  measuredLufs: string | null;
  measuredTruePeak: string | null;
  renderStatus: string;
  renderedAt: string | null;
  recipe: LibraryRecipe;
  title?: string;
  description?: string;
  titleApproved?: boolean;
};

export type QueueJob = {
  id: string;
  variantId: string;
  requestedBy?: string;
  status: "Queued" | "Rendering" | "Done" | "Failed" | "Cancelled";
  queuedAt: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  durationSeconds?: number;
  logsUrl?: string;
  failure?: { step?: string; exitCode?: number | null; durationSeconds?: number; runner?: string | null };
  fx?: import("./fx").FxBlock;
  repeats?: number;
  takeMarker?: string;
};

export type ReleaseType = "single" | "ep" | "album";

export type ReleaseTrack = {
  variantId: string;
  title: string;
  description: string;
  approvedAt: string | null;
};

export type Release = {
  id: string;
  type: ReleaseType;
  artist: string;
  title: string;
  genre: string;
  secondaryGenre: string;
  releaseDate: string;
  artSeed: number | null;
  songwriter: string;
  tracks: ReleaseTrack[];
  submitted: { at: string | null; storeUrl: string | null };
};
