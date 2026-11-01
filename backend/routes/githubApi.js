import express from "express";

import { detectLanguage } from "../service/languageDetector.js";
import { selectAnalyzer } from "../service/analyzerSelector.js";
import { runStaticAnalyzer } from "../service/staticAnalyzer.js";
import { normalizeFindings } from "../service/findingNormalizer.js";
import { generateReview } from "../service/reviewGenerator.js";
import { countIssues, saveReviewRun } from "../service/reviewStore.js";

const router = express.Router();

const GITHUB_API = "https://api.github.com";

router.post("/", async (req, res) => {
    try {
        console.log("api triggered");

        const {
            prId,
            repoName,
            username,
            commitSha
        } = req.body;

        // Get files changed by the PR
        const response = await fetch(
            `${GITHUB_API}/repos/${username}/${repoName}/pulls/${prId}/files?per_page=100`,
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28"
                }
            }
        );

        const changedFiles = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(changedFiles);
        }

        const files = [];
        const reviewPromises = [];

        for (const file of changedFiles) {

            const contentResponse = await fetch(
                `${GITHUB_API}/repos/${username}/${repoName}/contents/${file.filename}?ref=${commitSha}`,
                {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
                        "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28"
                    }
                }
            );

            const contentData = await contentResponse.json();

            if (!contentResponse.ok) {
                console.log(
                    `Could not fetch content for ${file.filename}`,
                    contentData
                );

                continue;
            }

            const sourceCode = Buffer.from(
                contentData.content,
                "base64"
            ).toString("utf-8");

            const currentFile = {
                filename: file.filename,
                content: sourceCode,
                diff: file.patch || ""
            };

            const language = detectLanguage(file.filename);
            const analyzer = selectAnalyzer(language);

            const fileRecord = {
                filename: file.filename,
                language,
                analyzerRan: false,
                findingCount: 0,
                reviews: [],
                usage: null
            };

            files.push(fileRecord);

            if (analyzer === "eslint") {

                const findings = await runStaticAnalyzer(currentFile);

                const normalizedFindings = normalizeFindings(
                    currentFile.filename,
                    findings.messages
                );

                fileRecord.analyzerRan = true;
                fileRecord.findingCount = normalizedFindings.length;

                if (normalizedFindings.length > 0) {

                    reviewPromises.push(
                        generateReview({
                            fileContent: currentFile.content,
                            findings: normalizedFindings,
                            diff: currentFile.diff
                        }).then((result) => {

                            fileRecord.reviews = result.review.issues.map(
                                (issue, index) => ({
                                    ...normalizedFindings[index],
                                    ...issue
                                })
                            );
                            fileRecord.usage = result.usage ?? null;
                        }).catch((reviewError) => {
                            console.error(
                                `Review failed for ${file.filename}`,
                                reviewError
                            );
                        })
                    );
                }
            }
        }

        await Promise.all(reviewPromises);

        let githubCommentPosted = false;

        for (const fileReview of files) {

            const issues = fileReview.reviews.filter(
                review => review.isIssue
            );

            if (issues.length === 0) {
                continue;
            }

            let commentBody = `## 🤖 Code Review\n\n`;
            commentBody += `### ${fileReview.filename}\n\n`;

            for (const review of issues) {

                commentBody += `**${review.severity.toUpperCase()} — Line ${review.line}**\n\n`;

                commentBody += `${review.explanation}\n\n`;

                commentBody += `**Confidence:** ${(review.confidence * 100).toFixed(0)}%\n\n`;

                commentBody += `**Suggested fix:** ${review.suggestedFix}\n\n`;

                commentBody += `---\n\n`;
            }

            const commentResponse = await fetch("http://localhost:3009/github-comment", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    prId,
                    repoName,
                    username,
                    reviewBody: commentBody
                })
            });

            if (commentResponse.ok) {
                githubCommentPosted = true;
            }
        }

        const issueCounts = countIssues(files);
        let storedRun;

        try {
            storedRun = await saveReviewRun({
                username,
                repoName,
                prId,
                commitSha,
                status: "completed",
                githubCommentPosted,
                files,
                issueCounts
            });
        } catch (storeError) {
            console.error("Failed to persist review run:", storeError);
            storedRun = {
                username,
                repoName,
                prId,
                commitSha,
                createdAt: new Date().toISOString(),
                status: "completed",
                githubCommentPosted,
                files,
                issueCounts
            };
        }

        console.log("ALL REVIEWS:");
        console.dir(files, { depth: null });

        return res.json(storedRun);

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            error: "Failed to retrieve PR files"
        });
    }
});

export default router;