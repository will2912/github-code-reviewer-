
import { collectPR } from "./prCollector.js";
import { buildReviewContext } from "./contextBuilder.js";
import { analyzeChangedFiles } from "./staticAnalyzer.js";
import { runReviewWithRetrieval } from "./retrievalLoop.js";
import { postReview } from "./reviewPoster.js";
import { saveReviewRun } from "./reviewStore.js";

export async function runReviewPipeline({ owner, repo, prId, post = true }) {
    const collected = await collectPR({ owner, repo, prId });
    const context = buildReviewContext(collected);

    if (context.files.length === 0) {
        return { status: "nothing_to_review", skipped: context.skipped };
    }

    const staticResults = await analyzeChangedFiles(collected.files, context);

    const review = await runReviewWithRetrieval({
        owner,
        repo,
        collected,
        context,
        staticResults
    });

    if (review.status !== "ok") return review;

    let posting = null;

    if (post && review.accepted.length > 0) {
        posting = await postReview({
            owner,
            repo,
            prId,
            headSha: collected.pr.headSha,
            summary: review.summary,
            findings: review.accepted
        });
    }

    // Group accepted AI findings by file.
    const acceptedByFile = new Map();

    for (const finding of review.accepted) {
        const items = acceptedByFile.get(finding.path) ?? [];
        items.push(finding);
        acceptedByFile.set(finding.path, items);
    }

    // Convert review results into the dashboard's expected structure.
    const files = context.files.map(fileContext => {
        const path = fileContext.path;
        const staticResult = staticResults[path];
        const accepted = acceptedByFile.get(path) ?? [];

        const acceptedLines = new Set(
            accepted.map(finding => finding.line)
        );

        // Confirmed AI findings.
        const aiReviews = accepted.map(finding => ({
            file: finding.path,
            line: finding.line,
            column: null,
            rule: finding.category || "ai-review",
            message: finding.message,
            isIssue: true,
            severity: finding.severity,
            confidence: finding.confidence / 100,
            explanation: finding.title || finding.message,
            suggestedFix: finding.suggestion || "No suggested fix provided."
        }));

        // Static findings not confirmed by AI.
        const dismissedStaticReviews = (staticResult?.findings ?? [])
            .filter(finding => !acceptedLines.has(finding.line))
            .map(finding => ({
                file: finding.file || path,
                line: finding.line,
                column: finding.column ?? null,
                rule: finding.rule || "static-analysis",
                message: finding.message,
                isIssue: false,
                severity: finding.severity === "error" ? "high" : "low",
                explanation:
                    "Static analyzer diagnostic was not confirmed as an issue by the AI reviewer.",
                suggestedFix:
                    "Review this diagnostic manually; no automatic fix was provided."
            }));

        const reviews = [...aiReviews, ...dismissedStaticReviews];

        return {
            filename: path,
            language: fileContext.language || "unknown",
            analyzerRan: Boolean(staticResult && !staticResult.skipped),
            findingCount: reviews.length,
            usage: null,
            reviews
        };
    });

    // Save the completed review in Redis.
    const savedRun = await saveReviewRun({
        username: owner,
        repoName: repo,
        prId,
        commitSha: collected.pr.headSha,
        status: review.status,
        githubCommentPosted: Boolean(posting && posting.posted > 0),
        files
    });

    return {
        ...review,
        posting,
        runId: savedRun.id
    };
}
