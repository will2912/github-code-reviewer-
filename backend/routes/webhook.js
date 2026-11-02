import express from "express";
import crypto from "node:crypto";
import { runReviewPipeline } from "../service/reviewPipeline.js";

const router = express.Router();

// Pull request events that should trigger a review.
const HANDLED = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);

// One review at a time per PR. A push that arrives meanwhile triggers one more run afterwards.
const running = new Map();

function validSignature(req) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!secret) {
        console.warn("GITHUB_WEBHOOK_SECRET is not set: webhook signature is NOT being checked");
        return true;
    }

    if (!req.rawBody) {
        console.error("rawBody is missing: add the verify option to express.json()");
        return false;
    }

    const expected =
        "sha256=" +
        crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");

    const received = req.get("x-hub-signature-256") ?? "";
    const a = Buffer.from(expected);
    const b = Buffer.from(received);

    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function queueReview(job) {
    const key = `${job.owner}/${job.repo}#${job.prId}`;

    if (running.has(key)) {
        running.get(key).again = true;
        console.log(`review already running for ${key}; will run once more afterwards`);
        return;
    }

    const state = { again: false };
    running.set(key, state);

    try {
        do {
            state.again = false;
            console.log(`review started: ${key}`);

            const result = await runReviewPipeline({
                ...job,
                // Set POST_REVIEWS=false in .env to test without commenting on GitHub.
                post: process.env.POST_REVIEWS !== "false"
            });

            console.log(
                `review finished: ${key} status=${result.status} ` +
                `accepted=${result.accepted?.length ?? 0} posting=${result.posting?.mode ?? "not posted"}`
            );
        } while (state.again);
    } catch (error) {
        console.error(`review failed for ${key}:`, error);
    } finally {
        running.delete(key);
    }
}

router.post("/", (req, res) => {
    if (!validSignature(req)) {
        return res.status(401).send("invalid signature");
    }

    const event = req.get("x-github-event");

    if (event === "ping") return res.status(200).send("pong");
    if (event !== "pull_request") return res.status(200).send("ignored");

    const { action, pull_request: pr, repository } = req.body ?? {};

    if (!HANDLED.has(action) || !pr || !repository || pr.draft) {
        return res.status(200).send("ignored");
    }

    // Answer GitHub right away. The review continues in the background.
    res.status(202).send("accepted");

    queueReview({
        owner: repository.owner.login,
        repo: repository.name,
        prId: pr.number
    });
});

export default router;
