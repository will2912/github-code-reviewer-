
import express from "express";

const router = express.Router();

router.post("/", async (req, res) => {
    try {
        const { action, pull_request, repository } = req.body ?? {};

        if (action !== "opened" && action !== "reopened") {
            return res.status(200).json({
                message: "Webhook event ignored",
            });
        }

        if (!pull_request?.number || !pull_request?.head?.sha ||
            !repository?.name || !repository?.owner?.login) {
            return res.status(400).json({
                error: "Invalid pull request webhook payload",
            });
        }

        const payload = {
            prId: pull_request.number,
            repoName: repository.name,
            username: repository.owner.login,
            commitSha: pull_request.head.sha,
        };

        // Accept the webhook quickly; run the review asynchronously.
        res.status(202).json({
            message: "Pull request review accepted",
            pullRequest: payload.prId,
        });

        fetch("http://localhost:3009/github-api", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        })
            .then(async (response) => {
                if (!response.ok) {
                    const error = await response.text();
                    throw new Error(
                        `Review API failed (${response.status}): ${error}`
                    );
                }
                console.log(`Review completed for PR #${payload.prId}`);
            })
            .catch((error) => {
                console.error("Webhook review processing failed:", error);
            });

    } catch (error) {
        console.error("Webhook error:", error);

        if (!res.headersSent) {
            res.status(500).json({
                error: "Failed to process webhook",
            });
        }
    }
});

export default router;
