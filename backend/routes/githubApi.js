import express from "express";
import { runReviewPipeline } from "../service/reviewPipeline.js";

const router = express.Router();

router.post("/", async (req, res) => {
    const { prId, repoName, username } = req.body;

    if (!prId || !repoName || !username) {
        return res
            .status(400)
            .json({ error: "prId, repoName and username are required" });
    }

    try {
        console.log(`review started: ${username}/${repoName}#${prId}`);

        const result = await runReviewPipeline({
            owner: username,
            repo: repoName,
            prId,
            // Set POST_REVIEWS=false in .env to test without commenting on GitHub.
            post: process.env.POST_REVIEWS !== "false"
        });

        console.log(
            `review finished: status=${result.status}, ` +
            `accepted=${result.accepted?.length ?? 0}, ` +
            `rejected=${result.rejected?.length ?? 0}, ` +
            `posting=${result.posting?.mode ?? "not posted"}`
        );

        return res.json(result);
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            error: "Failed to review the pull request"
        });
    }
});

export default router;