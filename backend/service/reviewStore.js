import { randomUUID } from "node:crypto";
import redis from "../lib/redis.js";

const RUN_PREFIX = "review:run:";
const RUNS_INDEX = "review:runs";
const MAX_RUNS = 50;

function runKey(id) {
    return `${RUN_PREFIX}${id}`;
}

function toSummary(run) {
    return {
        id: run.id,
        username: run.username,
        repoName: run.repoName,
        prId: run.prId,
        commitSha: run.commitSha,
        createdAt: run.createdAt,
        status: run.status,
        githubCommentPosted: run.githubCommentPosted,
        issueCounts: run.issueCounts,
        fileCount: run.files?.length ?? 0,
    };
}

export function countIssues(files) {
    const issueCounts = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        dismissed: 0,
    };

    for (const file of files) {
        for (const review of file.reviews ?? []) {
            if (!review.isIssue) {
                issueCounts.dismissed += 1;
                continue;
            }

            const severity = review.severity in issueCounts
                ? review.severity
                : "low";
            issueCounts[severity] += 1;
        }
    }

    return issueCounts;
}

export async function saveReviewRun(partial) {
    const id = partial.id ?? randomUUID();
    const createdAt = partial.createdAt ?? new Date().toISOString();
    const files = partial.files ?? [];

    const run = {
        id,
        username: partial.username,
        repoName: partial.repoName,
        prId: partial.prId,
        commitSha: partial.commitSha,
        createdAt,
        status: partial.status ?? "completed",
        githubCommentPosted: Boolean(partial.githubCommentPosted),
        files,
        issueCounts: partial.issueCounts ?? countIssues(files),
    };

    const timestamp = Date.parse(createdAt) || Date.now();

    await redis.set(runKey(id), JSON.stringify(run));
    await redis.zAdd(RUNS_INDEX, {
        score: timestamp,
        value: id,
    });

    const total = await redis.zCard(RUNS_INDEX);

    if (total > MAX_RUNS) {
        const excessIds = await redis.zRange(
            RUNS_INDEX,
            0,
            total - MAX_RUNS - 1
        );

        if (excessIds.length > 0) {
            await redis.zRem(RUNS_INDEX, excessIds);
            await redis.del(excessIds.map(runKey));
        }
    }

    return run;
}

export async function listReviewRuns() {
    const ids = await redis.zRange(RUNS_INDEX, 0, -1, { REV: true });

    if (ids.length === 0) {
        return [];
    }

    const documents = await redis.mGet(ids.map(runKey));

    return documents
        .filter(Boolean)
        .map((document) => toSummary(JSON.parse(document)));
}

export async function getReviewRun(id) {
    const document = await redis.get(runKey(id));

    if (!document) {
        return null;
    }

    return JSON.parse(document);
}
