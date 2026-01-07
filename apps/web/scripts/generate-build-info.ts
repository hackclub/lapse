#!/usr/bin/env tsx
/**
 * Generates build-time information including commit ID, build date, and contributors.
 * This script is run at build time to capture the state of the repository.
 * 
 * Uses GitHub API when git is unavailable (e.g., in Docker builds).
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";

interface Contributor {
    name: string;
    github: string;
    commits: number;
}

interface GitHubCommit {
    sha: string;
    commit: {
        author: { name: string; email: string; date: string };
    };
    author: { login: string } | null;
}

interface GitHubContributor {
    login: string;
    contributions: number;
}

function exec(cmd: string): string {
    try {
        return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    }
    catch {
        return "";
    }
}

function hasGit(): boolean {
    return exec("git rev-parse --git-dir") !== "";
}

const BOT_PATTERNS = [
    /\[bot\]/i,
    /^dependabot/i,
    /^renovate/i,
    /^github-actions/i,
    /^snyk-bot/i,
    /^greenkeeper/i,
];

function isBot(name: string): boolean {
    return BOT_PATTERNS.some(pattern => pattern.test(name));
}

async function fetchAllCommits(): Promise<GitHubCommit[]> {
    const allCommits: GitHubCommit[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
        const url = `https://api.github.com/repos/hackclub/lapse/commits?per_page=${perPage}&page=${page}`;
        const response = await fetch(url, {
            headers: { "Accept": "application/vnd.github+json" }
        });

        if (!response.ok) {
            console.warn(`GitHub API returned ${response.status}`);
            return allCommits;
        }

        const commits: GitHubCommit[] = await response.json();
        if (commits.length === 0) break;

        allCommits.push(...commits);
        if (commits.length < perPage) break;
        page++;
    }

    return allCommits;
}

async function fetchContributorsFromAPI(): Promise<GitHubContributor[]> {
    const allContributors: GitHubContributor[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
        const url = `https://api.github.com/repos/hackclub/lapse/contributors?per_page=${perPage}&page=${page}`;
        const response = await fetch(url, {
            headers: { "Accept": "application/vnd.github+json" }
        });

        if (!response.ok) {
            console.warn(`GitHub API returned ${response.status}`);
            return allContributors;
        }

        const contributors: GitHubContributor[] = await response.json();
        if (contributors.length === 0) break;

        allContributors.push(...contributors);
        if (contributors.length < perPage) break;
        page++;
    }

    return allContributors;
}

async function getContributorsFromGitHub(commits: GitHubCommit[]): Promise<{ contributors: Contributor[]; allHaveGitHub: boolean }> {
    const apiContributors = await fetchContributorsFromAPI();

    const loginToContributions = new Map<string, number>();
    for (const c of apiContributors) {
        if (!isBot(c.login)) {
            loginToContributions.set(c.login, c.contributions);
        }
    }

    const loginToName = new Map<string, string>();
    for (const commit of commits) {
        const login = commit.author?.login;
        const name = commit.commit.author.name;
        if (login && name && !loginToName.has(login)) {
            loginToName.set(login, name);
        }
    }

    const contributors: Contributor[] = [];
    for (const [login, commits] of loginToContributions) {
        const name = loginToName.get(login) || login;
        contributors.push({ name, github: login, commits });
    }

    contributors.sort((a, b) => b.commits - a.commits);

    return { contributors, allHaveGitHub: true };
}

async function getContributorsFromGit(commits: GitHubCommit[]): Promise<{ contributors: Contributor[]; allHaveGitHub: boolean }> {
    const shortlogOutput = exec("git shortlog -sne --no-merges HEAD");
    if (!shortlogOutput) return { contributors: [], allHaveGitHub: true };

    const emailToGitHub = new Map<string, string>();
    for (const commit of commits) {
        const email = commit.commit.author.email?.toLowerCase();
        const login = commit.author?.login;
        if (email && login) {
            emailToGitHub.set(email, login);
        }
    }

    const contributors: Contributor[] = [];

    for (const line of shortlogOutput.split("\n")) {
        const match = line.match(/^\s*(\d+)\s+(.+?)\s+<([^>]+)>$/);
        if (!match) continue;

        const commits = parseInt(match[1], 10);
        const name = match[2].trim();
        const email = match[3].trim().toLowerCase();

        if (isBot(name) || isBot(email)) continue;

        const github = emailToGitHub.get(email) || null;
        contributors.push({ name, github: github!, commits });
    }

    contributors.sort((a, b) => b.commits - a.commits);

    const allHaveGitHub = contributors.every(c => c.github !== null);
    return { contributors, allHaveGitHub };
}

async function main() {
    const useGit = hasGit();
    console.log(`Using ${useGit ? "git + GitHub API" : "GitHub API only"}`);

    let commitId = process.env.SOURCE_COMMIT || "";
    let buildDate: number;

    const commits = await fetchAllCommits();

    if (useGit) {
        if (!commitId) {
            commitId = exec("git rev-parse HEAD") || "unknown";
        }
        const commitDateStr = exec(`git show -s --format=%cI ${commitId}`);
        buildDate = commitDateStr ? new Date(commitDateStr).getTime() : Date.now();
    }
    else {
        if (commits.length > 0) {
            const latestCommit = commits[0];
            if (!commitId) {
                commitId = latestCommit.sha;
            }
            buildDate = new Date(latestCommit.commit.author.date).getTime();
        }
        else {
            if (!commitId) {
                commitId = "unknown";
            }
            buildDate = Date.now();
        }
    }

    const commitShort = commitId.slice(0, 7);

    const { contributors, allHaveGitHub } = useGit
        ? await getContributorsFromGit(commits)
        : await getContributorsFromGitHub(commits);

    const buildInfo = {
        commitId,
        commitShort,
        buildDate,
        contributors: allHaveGitHub
            ? contributors.map(c => ({ name: c.name, github: c.github }))
            : contributors.map(c => ({ name: c.name })),
    };

    const outputPath = join(__dirname, "../src/generated/build-info.json");
    writeFileSync(outputPath, JSON.stringify(buildInfo, null, 2));
    console.log(`Build info written to ${outputPath}`);
    console.log(`  Commit: ${commitShort}`);
    console.log(`  Date: ${new Date(buildDate).toISOString()}`);
    console.log(`  Contributors: ${contributors.length}${allHaveGitHub ? "" : " (GitHub links unavailable)"}`);
}

main();
