import { collectPR } from "./prCollector.js";
import { buildReviewContext } from "./contextBuilder.js";
import { analyzeChangedFiles } from "./staticAnalyzer.js";
import { runReviewWithRetrieval } from "./retrievalLoop.js";
import { postReview } from "./reviewPoster.js";

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

    return { ...review, posting };
}