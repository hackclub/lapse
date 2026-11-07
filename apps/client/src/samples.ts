import type { AdminAuditLogEntry, AdminUserRow, GlobalStats, HackatimeProject, PublicUser, Timelapse } from "@hackclub/lapse-api";

/*
  Stand-ins for data that hasn't loaded yet. Skullet renders these unseen and traces the result into a skeleton, so
  what matters is that every string is about as long as a real one - the values themselves are never shown. Media
  URLs are blank pixels, as the browser would otherwise go and fetch them for content nobody sees.
*/

const BLANK_IMAGE = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
const SAMPLE_DATE = Date.UTC(2026, 0, 1);

export const SAMPLE_USER: PublicUser = {
  id: "sampleuser00",
  createdAt: SAMPLE_DATE,
  handle: "orpheus",
  displayName: "Orpheus Dino",
  profilePictureUrl: BLANK_IMAGE,
  bio: "Building things and recording all of it.",
  urls: [],
  hackatimeId: null,
  slackId: null
};

export const SAMPLE_TIMELAPSE: Timelapse = {
  id: "sampletl0000",
  createdAt: SAMPLE_DATE,
  name: "Building a tiny game engine",
  description: "Spent the evening wiring up the renderer and finally got sprites on the screen. Next up is input handling.",
  visibility: "PUBLIC",
  owner: SAMPLE_USER,
  comments: [],
  // Never loaded - but a timelapse without one counts as still processing, and grids hide those from non-admins.
  playbackUrl: "https://lapse.hackclub.com/sample.mp4",
  blocker: null,
  thumbnailUrl: null,
  duration: 2 * 60 * 60 + 34 * 60,
  isDraft: false
};

export const SAMPLE_TIMELAPSES: Timelapse[] = [
  "Building a tiny game engine",
  "Redesigning my portfolio",
  "Soldering a macropad",
  "Rust CLI for my notes",
  "Making a Discord bot",
  "Weekend hackathon project"
].map((name, i) => ({ ...SAMPLE_TIMELAPSE, id: `sampletl000${i}`, name }));

export const SAMPLE_LEADERBOARD = {
  leaderboard: ["Orpheus", "Heidi", "Prox", "Sam Poder", "Zach", "Kaia"].map((displayName, i) => ({
    id: `sampleusr00${i}`,
    handle: displayName.toLowerCase(),
    displayName,
    secondsThisWeek: 12 * 60 * 60,
    pfp: BLANK_IMAGE
  }))
};

// The feed is 50 long, but only about the first screen of it is sampled. Skullet measures a skeleton on the main
// thread, and so does the shimmer run - fifty cards' worth of measuring froze it for a second or two on every load.
// What the sample leaves out is below the fold, so the page growing there on reveal moves nothing anyone can see.
export const SAMPLE_RECENT = {
  timelapses: Array.from({ length: 9 }, (_, i) => ({ ...SAMPLE_TIMELAPSES[i % SAMPLE_TIMELAPSES.length], id: `samplerecent${i}` }))
};

export const SAMPLE_STATS: GlobalStats = {
  generatedAt: SAMPLE_DATE,
  users: { total: 12345, creators: 4321, newThisWeek: 123 },
  time: {
    totalSeconds: 98765 * 3600,
    thisWeekSeconds: 1234 * 3600,
    averageTimelapseSeconds: 75 * 60,
    longestTimelapseSeconds: 9 * 60 * 60
  },
  timelapses: { published: 23456, public: 20000, unlisted: 3456, lookout: 12000, browser: 11456, hackatimeSynced: 19876 },
  recordings: { started: 34567, drafts: 1234 },
  comments: 5678,
  weekly: Array.from({ length: 12 }, (_, i) => ({
    weekStart: SAMPLE_DATE + i * 7 * 24 * 60 * 60 * 1000,
    seconds: 1000 * 3600,
    timelapses: 500
  }))
};

export const SAMPLE_ADMIN_USER: AdminUserRow = {
  id: "sampleuser00",
  email: "orpheus@hackclub.com",
  handle: "orpheus",
  displayName: "Orpheus Dino",
  permissionLevel: "USER",
  profilePictureUrl: BLANK_IMAGE,
  bio: "",
  hackatimeId: "12345",
  slackId: "U0123456789",
  createdAt: SAMPLE_DATE,
  lastHeartbeat: SAMPLE_DATE
};

export const SAMPLE_HACKATIME_PROJECTS: HackatimeProject[] = [
  { name: "lapse", totalSeconds: 40 * 60 * 60, languages: ["TypeScript", "CSS"] },
  { name: "my-cool-website", totalSeconds: 12 * 60 * 60, languages: ["HTML", "JavaScript"] },
  { name: "macropad-firmware", totalSeconds: 6 * 60 * 60, languages: ["C"] },
  { name: "dotfiles", totalSeconds: 2 * 60 * 60, languages: ["Lua"] }
];

export const SAMPLE_AUDIT_LOG: AdminAuditLogEntry[] = ([
  { visibility: { from: "PUBLIC", to: "UNLISTED" } },
  { permissionLevel: { from: "USER", to: "ADMIN" } },
  { displayName: { from: "Orpheus", to: "Orpheus Dino" } }
] as AdminAuditLogEntry["changes"][]).map((changes, i) => ({
  id: `sampleaudit${i}`,
  actor: { id: "sampleuser00", handle: "orpheus", displayName: "Orpheus Dino" },
  entity: "user",
  entityId: "sampleuser00",
  changes,
  createdAt: SAMPLE_DATE
}));
