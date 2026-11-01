
import express from "express";
import dotenv from "dotenv";

import webhookRouter from "./routes/webhook.js";
import githubApiRouter from "./routes/githubApi.js";
import githubCommentRouter from "./routes/githubComment.js";
import reviewsRouter from "./routes/reviews.js";

dotenv.config();

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "code-reviewer",
    });
});

app.use("/webhook", webhookRouter);
app.use("/github-api", githubApiRouter);
app.use("/github-comment", githubCommentRouter);
app.use("/reviews", reviewsRouter);

const PORT = process.env.PORT || 3009;

app.listen(PORT, () => {
    console.log(`Code reviewer listening on port ${PORT}`);
});
