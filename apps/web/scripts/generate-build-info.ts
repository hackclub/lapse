#!/usr/bin/env tsx
/**
 * Generates build-time information including commit ID, build date, and contributors.
 * This script is run at build time to capture the state of the repository.
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";

interface Contributor {
    name: string;
    github: string | null;
    commits: number;
    linesChanged: number;
}

function exec(cmd: string): string {
    try {
        return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    }
    catch {
        return "";
    }
}

interface GitHubCommit {
    commit: { author: { email: string } };
    author: { login: string } | null;
}

async function fetchGitHubEmailMap(): Promise<Map<string, string>> {
    const emailToGitHub = new Map<string, string>();

    try {
        let page = 1;
        const perPage = 100;

        while (true) {
            const url = `https://api.github.com/repos/hackclub/lapse/commits?per_page=${perPage}&page=${page}`;
            const response = await fetch(url, {
                headers: { "Accept": "application/vnd.github+json" }
            });

            if (!response.ok) {
                console.warn(`GitHub API returned ${response.status}, skipping GitHub username resolution`);
                return new Map();
            }

            const commits: GitHubCommit[] = await response.json();
            if (commits.length === 0) break;

            for (const commit of commits) {
                const email = commit.commit.author.email?.toLowerCase();
                const login = commit.author?.login;
                if (email && login && !emailToGitHub.has(email)) {
                    emailToGitHub.set(email, login);
                }
            }

            if (commits.length < perPage)
                break;

            page++;
        }
    }
    catch (err) {
        console.warn("Failed to fetch from GitHub API:", err);
        return new Map();
    }

    return emailToGitHub;
}

function findGitHubForAuthor(name: string, primaryEmail: string, emailToGitHub: Map<string, string>): string | null {
    const fromPrimary = emailToGitHub.get(primaryEmail.toLowerCase());
    if (fromPrimary) return fromPrimary;

    const authorEmails = exec(`git log --author="${name}" --format='%aE' --no-merges HEAD`);
    if (!authorEmails) return null;

    for (const email of authorEmails.split("\n")) {
        const trimmed = email.trim().toLowerCase();
        if (!trimmed) continue;
        const github = emailToGitHub.get(trimmed);
        if (github) return github;
    }
    return null;
}

async function getContributors(): Promise<{ contributors: Contributor[]; allHaveGitHub: boolean }> {
    const shortlogOutput = exec("git shortlog -sne --no-merges HEAD");
    if (!shortlogOutput) return { contributors: [], allHaveGitHub: true };

    const emailToGitHub = await fetchGitHubEmailMap();

    const contributors: Contributor[] = [];

    for (const line of shortlogOutput.split("\n")) {
        const match = line.match(/^\s*(\d+)\s+(.+?)\s+<([^>]+)>$/);
        if (!match) continue;

        const commits = parseInt(match[1], 10);
        const name = match[2].trim();
        const email = match[3].trim();

        const isBot = [
            /\[bot\]/i,
            /^dependabot/i,
            /^renovate/i,
            /^github-actions/i,
            /^snyk-bot/i,
            /^greenkeeper/i,
        ].some(pattern => pattern.test(name) || pattern.test(email));

        if (isBot)
            continue;

        const github = findGitHubForAuthor(name, email, emailToGitHub);

        const linesOutput = exec(`git log --author="${email}" --pretty=tformat: --numstat --no-merges`);
        let linesChanged = 0;

        for (const statLine of linesOutput.split("\n")) {
            const parts = statLine.split("\t");
            if (parts.length >= 2) {
                const added = parseInt(parts[0], 10) || 0;
                const deleted = parseInt(parts[1], 10) || 0;
                linesChanged += added + deleted;
            }
        }

        contributors.push({ name, github, commits, linesChanged });
    }

    contributors.sort((a, b) => {
        const scoreA = a.commits * 10 + Math.sqrt(a.linesChanged);
        const scoreB = b.commits * 10 + Math.sqrt(b.linesChanged);
        return scoreB - scoreA;
    });

    const allHaveGitHub = contributors.every(c => c.github !== null);
    return { contributors, allHaveGitHub };
}

async function main() {
    const commitId = process.env.SOURCE_COMMIT || exec("git rev-parse HEAD") || "HEAD";
    const commitShort = commitId.slice(0, 7);

    let buildDate: number;
    const commitDateStr = exec(`git show -s --format=%cI ${commitId}`);
    if (commitDateStr) {
        buildDate = new Date(commitDateStr).getTime();
    }
    else {
        buildDate = Date.now();
    }

    const { contributors, allHaveGitHub } = await getContributors();

    const buildInfo = {
        commitId,
        commitShort,
        buildDate,
        contributors: allHaveGitHub
            ? contributors.map(c => ({ name: c.name, github: c.github! }))
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
