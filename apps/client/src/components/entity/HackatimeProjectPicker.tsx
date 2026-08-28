import { KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@hackclub/icons";
import clsx from "clsx";
import { formatDuration } from "@hackclub/lapse-shared";
import type { HackatimeProject } from "@hackclub/lapse-api";

import { useRouter } from "next/router";

import { api } from "@/api";
import type { IconGlyph } from "@/common";
import { Skeleton } from "@/components/ui/Skeleton";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { RELINK_SESSION_KEY, useHackatimeRelink } from "@/hooks/useHackatimeRelink";

/** The maximum length of a Hackatime project name, as enforced by the API contract. */
const MAX_PROJECT_NAME_LENGTH = 128;

/** How many projects a user needs to have before we show a search box above the list. */
const SEARCH_THRESHOLD = 6;

/** How many language pills we show next to a project before collapsing the rest into a counter. */
const MAX_LANGUAGE_PILLS = 3;

/**
 * Languages that are rarely what a project is actually written in - shells, build files and glue. A project can be
 * held together by these, but it's almost never what its author would call it.
 */
const SECONDARY_LANGUAGES = new Set([
  "autohotkey", "awk", "bash", "batchfile", "caddyfile", "cmake", "docker", "dockerfile", "fish", "gnuplot",
  "groovy", "makefile", "nginx configuration file", "powershell", "sed", "shell script", "vim script", "zsh"
]);

/** Languages that say nothing at all about a project - config, docs and other filler. */
const FILLER_LANGUAGES = new Set([
  "csv", "git config", "gitignore file", "image (svg)", "ini", "json", "log file", "markdown", "other",
  "text", "toml", "xml", "yaml"
]);

/**
 * Hackatime gives us every language it ever saw in a project as an unordered set, with no indication of how much
 * time was spent in any of them - so we rank them ourselves, and let the interesting ones surface first.
 */
function languagePriority(language: string) {
  const key = language.toLowerCase();

  if (FILLER_LANGUAGES.has(key))
    return 2;

  if (SECONDARY_LANGUAGES.has(key))
    return 1;

  return 0;
}

function summarizeLanguages(languages: string[]) {
  const ranked = [...languages].sort((a, b) => languagePriority(a) - languagePriority(b));

  return {
    pills: ranked.slice(0, MAX_LANGUAGE_PILLS),
    hiddenCount: Math.max(ranked.length - MAX_LANGUAGE_PILLS, 0)
  };
}

const PILL_COLORS = {
  red: "bg-red/15 text-red",
  orange: "bg-orange/15 text-orange",
  yellow: "bg-yellow/15 text-yellow",
  green: "bg-green/15 text-green",
  cyan: "bg-cyan/15 text-cyan",
  blue: "bg-blue/15 text-blue",
  purple: "bg-purple/15 text-purple",
  grey: "bg-darkless text-muted"
} as const;

type PillColor = keyof typeof PILL_COLORS;

/** Colors of well-known languages, kept close to what people are used to seeing elsewhere. */
const LANGUAGE_COLORS: Record<string, PillColor> = {
  "assembly": "red",
  "bash": "green",
  "c": "blue",
  "c#": "purple",
  "c++": "blue",
  "css": "blue",
  "dart": "cyan",
  "elixir": "purple",
  "erlang": "red",
  "gdscript3": "blue",
  "glsl": "green",
  "go": "cyan",
  "haskell": "purple",
  "html": "orange",
  "java": "red",
  "javascript": "yellow",
  "jsx": "yellow",
  "kotlin": "purple",
  "lua": "blue",
  "objective-c": "blue",
  "perl": "cyan",
  "php": "purple",
  "powershell": "blue",
  "python": "yellow",
  "r": "blue",
  "ruby": "red",
  "rust": "orange",
  "sass": "purple",
  "scala": "red",
  "scss": "purple",
  "shell script": "green",
  "sql": "cyan",
  "svelte": "orange",
  "swift": "orange",
  "tsx": "blue",
  "typescript": "blue",
  "vue.js": "green",
  "zig": "orange"
};

const FALLBACK_PILL_COLORS: PillColor[] = ["red", "orange", "yellow", "green", "cyan", "blue", "purple"];

function languagePillColor(language: string): PillColor {
  const key = language.toLowerCase();

  if (FILLER_LANGUAGES.has(key))
    return "grey";

  const known = LANGUAGE_COLORS[key];
  if (known)
    return known;

  // Anything we don't know about still gets a stable color, so that it looks the same everywhere it shows up.
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }

  return FALLBACK_PILL_COLORS[Math.abs(hash) % FALLBACK_PILL_COLORS.length];
}

const TEXT_INPUT_CLASS = "border border-slate outline-red focus:outline-2 transition-all rounded-xl p-2 px-4 w-full placeholder:text-secondary";

type SyncMode = "existing" | "new";

let cachedProjects: HackatimeProject[] | null = null;
let pendingProjects: Promise<HackatimeProject[]> | null = null;

/**
 * Loads the user's Hackatime projects, reusing the result for the rest of the session. Call this ahead of showing
 * the picker - it can then render its list right away, instead of flashing skeletons and resizing around the user.
 *
 * Only successful responses are cached, so a request made before the user is authenticated doesn't poison the list.
 */
export function prefetchHackatimeProjects() {
  if (cachedProjects)
    return Promise.resolve(cachedProjects);

  pendingProjects ??= api.hackatime.allProjects({})
    .then(res => {
      if (!res.ok)
        throw new Error(res.message);

      cachedProjects = res.data.projects;
      return cachedProjects;
    })
    .catch(() => [])
    .finally(() => { pendingProjects = null; });

  return pendingProjects;
}

function PickerRow({ icon, selected, onClick, className, children }: {
  icon?: IconGlyph;
  selected: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  const glyph = selected ? "checkmark" : icon;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={clsx(
        "flex items-center gap-2 w-full text-left px-4 py-2 cursor-pointer transition-colors",
        selected ? "bg-red text-white" : "hover:bg-darkless",
        className
      )}
    >
      {/* The slot is always occupied, so that selecting a row doesn't shift its label around. */}
      <span className="w-5 shrink-0 flex items-center">
        { glyph && <Icon glyph={glyph} size={20} className={clsx(!selected && "text-muted")} /> }
      </span>

      {children}
    </button>
  );
}

function ProjectRow({ project, selected, onClick }: {
  project: HackatimeProject;
  selected: boolean;
  onClick: () => void;
}) {
  const { pills, hiddenCount } = summarizeLanguages(project.languages);

  return (
    <PickerRow selected={selected} onClick={onClick}>
      <span className="flex-1 min-w-0 flex items-center gap-2">
        <span className="font-bold truncate" title={project.name}>{project.name}</span>

        <span className="hidden sm:flex items-center gap-1 shrink-0">
          {pills.map(language => (
            <span
              key={language}
              className={clsx(
                "px-2 py-0.5 rounded-full text-xs font-semibold",
                selected ? "bg-white/20 text-white" : PILL_COLORS[languagePillColor(language)]
              )}
            >
              {language}
            </span>
          ))}

          {hiddenCount > 0 && (
            <span className={clsx("text-xs font-semibold", selected ? "text-white/80" : "text-muted")}>
              +{hiddenCount}
            </span>
          )}
        </span>
      </span>

      <span className={clsx("shrink-0 text-sm", selected ? "text-white/80" : "text-muted")}>
        {formatDuration(project.totalSeconds)}
      </span>
    </PickerRow>
  );
}

/**
 * Lets the user pick one of their Hackatime projects, or name a new one. The picker owns the choice and reports it
 * back via `onChange` - `null` meaning "nothing picked yet".
 *
 * `onChange` and `onLoadingChange` are expected to be stable across renders (a `useState` setter is ideal); they are
 * called from effects, so an inline lambda would fire them on every render.
 */
export function HackatimeProjectPicker({ isActive, initialProject, onChange, onLoadingChange }: {
  /** Whether the picker is currently on-screen. Switching this on refreshes the picker's state. */
  isActive: boolean;

  /** The project to start out with, if the user already made a choice - say, before stepping away and back. */
  initialProject?: string | null;

  onChange: (hackatimeProject: string | null) => void;
  onLoadingChange?: (isLoading: boolean) => void;
}) {
  const router = useRouter();
  const needsRelink = useHackatimeRelink();

  const [projects, setProjects] = useState<HackatimeProject[]>(() => cachedProjects ?? []);
  const [isLoadingProjects, setIsLoadingProjects] = useState(cachedProjects === null);

  function reconnect() {
    sessionStorage.removeItem(RELINK_SESSION_KEY);
    router.push(`/auth?force=1&redirect=${encodeURIComponent(router.asPath)}`);
  }

  const [mode, setMode] = useState<SyncMode>("existing");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [query, setQuery] = useState("");

  const newProjectInputRef = useRef<HTMLInputElement>(null);

  // Only read when the picker becomes active - it would otherwise fight the user's own choice as they make it.
  const initialProjectRef = useRef(initialProject);
  useEffect(() => { initialProjectRef.current = initialProject; }, [initialProject]);

  const isSeededRef = useRef(false);

  // The list loads even while the picker is off-screen, so that whoever renders it can reserve its height upfront.
  useEffect(() => {
    if (cachedProjects)
      return;

    let isStale = false;

    prefetchHackatimeProjects().then(loaded => {
      if (isStale)
        return;

      setProjects(loaded);
      setIsLoadingProjects(false);
    });

    return () => { isStale = true; };
  }, []);

  useEffect(() => {
    if (!isActive) {
      isSeededRef.current = false;
      return;
    }

    // Seeding needs the list, to tell "an existing project" apart from "a name the user typed in".
    if (isSeededRef.current || isLoadingProjects)
      return;

    isSeededRef.current = true;
    setQuery("");
    setSkipSummaryTransition(true);

    const restored = initialProjectRef.current;

    if (!restored) {
      setMode("existing");
      setSelectedProject(null);
      setNewProjectName("");
      return;
    }

    if (projects.some(x => x.name === restored)) {
      setMode("existing");
      setSelectedProject(restored);
      setNewProjectName("");
    }
    else {
      setMode("new");
      setSelectedProject(null);
      setNewProjectName(restored);
    }
  }, [isActive, isLoadingProjects, projects]);

  const hasProjects = projects.length > 0;

  // Users without any Hackatime projects have nothing to pick from - creating one is the only option they have.
  const effectiveMode: SyncMode = hasProjects ? mode : "new";

  useEffect(() => {
    if (hasProjects && effectiveMode === "new") {
      newProjectInputRef.current?.focus();
    }
  }, [hasProjects, effectiveMode]);

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized)
      return projects;

    return projects.filter(x => x.name.toLowerCase().includes(normalized));
  }, [projects, query]);

  const trimmedNewName = newProjectName.trim();
  const chosenProject = effectiveMode === "new" ? (trimmedNewName || null) : selectedProject;

  const duplicateOfExisting = effectiveMode === "new" && trimmedNewName
    ? projects.find(x => x.name.toLowerCase() === trimmedNewName.toLowerCase()) ?? null
    : null;

  useEffect(() => {
    onChange(chosenProject);
  }, [chosenProject, onChange]);

  useEffect(() => {
    onLoadingChange?.(isLoadingProjects);
  }, [isLoadingProjects, onLoadingChange]);

  const isChoiceNew = effectiveMode === "new" && !duplicateOfExisting;

  // Kept around while the summary collapses, so that the text fades out with it instead of blinking away.
  const [shownSummary, setShownSummary] = useState<{ name: string, isNew: boolean } | null>(null);

  useEffect(() => {
    if (chosenProject) {
      setShownSummary({ name: chosenProject, isNew: isChoiceNew });
    }
  }, [chosenProject, isChoiceNew]);

  const [skipSummaryTransition, setSkipSummaryTransition] = useState(false);

  useEffect(() => {
    if (!skipSummaryTransition)
      return;

    // The skip only applies to the render that changed the layout - by the next frame, transitions are welcome back.
    const frame = requestAnimationFrame(() => setSkipSummaryTransition(false));
    return () => cancelAnimationFrame(frame);
  }, [skipSummaryTransition]);

  /**
   * Switching modes shows or hides the "new project" field, which resizes the column on its own. Animating the
   * summary on top of that makes everything lurch twice, so the summary just snaps into place instead.
   */
  function switchMode(next: SyncMode) {
    if (next !== mode) {
      setSkipSummaryTransition(true);
    }

    setMode(next);
  }

  function handleSelectExisting(name: string) {
    switchMode("existing");
    setSelectedProject(name);
  }

  /** Clicking the row you already picked clears the choice - that's how a caller ends up with "no project". */
  function handleToggleExisting(name: string) {
    if (effectiveMode === "existing" && selectedProject === name) {
      setSelectedProject(null);
      return;
    }

    handleSelectExisting(name);
  }

  function handleToggleNew() {
    if (effectiveMode === "new" && hasProjects) {
      switchMode("existing");
      return;
    }

    switchMode("new");

    if (!newProjectName && query.trim()) {
      setNewProjectName(query.trim());
    }
  }

  function handleSearchKeyDown(ev: KeyboardEvent<HTMLInputElement>) {
    if (ev.key !== "Enter" || filteredProjects.length !== 1)
      return;

    ev.preventDefault();
    handleSelectExisting(filteredProjects[0].name);
  }

  if (isLoadingProjects) {
    return (
      <div className="flex flex-col gap-3">
        <span className="font-bold">Loading your Hackatime projects...</span>
        <Skeleton className="w-full h-9" />
        <Skeleton className="w-full h-9" />
        <Skeleton className="w-full h-9" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3">
        {hasProjects ? (
          <>
            {projects.length >= SEARCH_THRESHOLD && (
              <div className="flex items-center px-3 rounded-xl border border-slate focus-within:outline-2 focus-within:outline-red">
                <Icon glyph="search" size={20} className="text-muted shrink-0" />
                <input
                  type="text"
                  value={query}
                  onChange={ev => setQuery(ev.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  aria-label="Search your Hackatime projects"
                  placeholder="Search your projects..."
                  className="flex-1 min-w-0 bg-transparent outline-none py-2 pl-1 placeholder:text-secondary"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="cursor-pointer text-muted shrink-0 flex items-center"
                  >
                    <Icon glyph="view-close-small" size={20} />
                  </button>
                )}
              </div>
            )}

            <div
              role="radiogroup"
              aria-label="Hackatime project"
              className="flex flex-col border border-slate rounded-xl overflow-hidden"
            >
              <div className="flex flex-col max-h-64 overflow-y-auto overscroll-contain">
                {filteredProjects.length === 0 ? (
                  <p className="px-4 py-2 text-muted">
                    No existing projects matched &ldquo;{query.trim()}&rdquo;.
                  </p>
                ) : (
                  filteredProjects.map(project => (
                    <ProjectRow
                      key={project.name}
                      project={project}
                      selected={effectiveMode === "existing" && selectedProject === project.name}
                      onClick={() => handleToggleExisting(project.name)}
                    />
                  ))
                )}
              </div>

              <div className="border-t border-slate">
                <PickerRow
                  icon="plus"
                  selected={effectiveMode === "new"}
                  onClick={handleToggleNew}
                  className="py-3!"
                >
                  <span className="flex-1 font-bold">
                    {
                      filteredProjects.length === 0 && query.trim()
                        ? <>Make a new project called &ldquo;{query.trim()}&rdquo;</>
                        : "I want to make a new project"
                    }
                  </span>
                </PickerRow>
              </div>
            </div>
          </>
        ) : needsRelink ? (
          <Alert variant="warning" icon="private">
            <div className="flex flex-col gap-3">
              <p className="font-bold">Relink Hackatime to sync</p>
              <p>
                Hackatime won&apos;t let us read your projects until you authorize Lapse again, so this list is
                empty even if you have projects. Naming a new one here would sync your time somewhere unexpected.
              </p>

              <Button kind="primary" onClick={reconnect}>Relink Hackatime</Button>
            </div>
          </Alert>
        ) : (
          <Alert variant="info" icon="idea">
            <p>We couldn&apos;t find any projects on your Hackatime account. Give this one a name below - we&apos;ll create it for you.</p>
          </Alert>
        )}

        {effectiveMode === "new" && (
          <div className={clsx("flex flex-col", hasProjects && "mt-3")}>
            <label htmlFor="hackatime-new-project" className="font-bold">Name of the new project</label>
            <p className="text-muted mb-3">This is usually the name of the folder you code in.</p>

            <input
              id="hackatime-new-project"
              ref={newProjectInputRef}
              type="text"
              value={newProjectName}
              onChange={ev => setNewProjectName(ev.target.value)}
              maxLength={MAX_PROJECT_NAME_LENGTH}
              autoComplete="off"
              placeholder="e.g. my-cool-website"
              className={TEXT_INPUT_CLASS}
            />

            {duplicateOfExisting && (
              <p className="text-yellow mt-2">
                You already have a project called &ldquo;{duplicateOfExisting.name}&rdquo; -{" "}
                <button
                  type="button"
                  onClick={() => handleSelectExisting(duplicateOfExisting.name)}
                  className="underline cursor-pointer font-bold"
                >
                  pick it from the list instead
                </button>.
              </p>
            )}
          </div>
        )}
      </div>

      {/*
        The summary makes room for itself rather than appearing on top of what's below it. The row grows from 0fr to
        1fr to open up the space, and only once it's open does the text fade in - it is deliberately never clipped,
        which is why nothing here hides its overflow.
      */}
      <div
        aria-hidden={!chosenProject}
        className={clsx(
          "grid",
          !skipSummaryTransition && "transition-[grid-template-rows] duration-300 ease-out",
          chosenProject ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="min-h-0">
          <p
            className={clsx(
              "pt-6 wrap-break-word text-center text-smoke",
              !skipSummaryTransition && "transition-opacity duration-200 ease-out",
              chosenProject ? "opacity-100 delay-100" : "opacity-0 pointer-events-none"
            )}
          >
            Your timelapsed time will be added to <span className="font-bold">{shownSummary?.name}</span>
            {shownSummary?.isNew ? ", a brand new project." : "."}
          </p>
        </div>
      </div>
    </div>
  );
}
