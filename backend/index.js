import express from "express";
import dotenv from "dotenv";

import webhookRouter from "./routes/webhook.js";
import githubApiRouter from "./routes/githubApi.js";
import githubCommentRouter from "./routes/githubComment.js";

dotenv.config();

const app = express();

app.use(express.json());

app.use("/webhook", webhookRouter);
app.use("/github-api", githubApiRouter);
app.use("/github-comment", githubCommentRouter);

app.listen(3009, () => {
    console.log("listening");
});