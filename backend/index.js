import express from "express";
const app = express();
import dotenv from "dotenv"
dotenv.config();
app.use(express.json());
const GITHUB_API = "https://api.github.com"
import { detectLanguage } from "./service/languageDetector.js";
import { selectAnalyzer } from "./service/analyzerSelector.js";
import { runStaticAnalyzer } from "./service/staticAnalyzer.js";
import { normalizeFindings } from "./service/findingNormalizer.js";
import { generateReview } from "./service/reviewGenerator.js";


app.post("/webhook", async (req, res) => {
    console.log("webhook triggered")
    const action = await req.body.action;
    if (action !== "opened" && action !== "reopened") {
        return res.status(200).send("ignored")
    }

    const prId = req.body.pull_request.number;
    const repoName = req.body.repository.name;
    const username = req.body.repository.owner.login;
    const commitSha = req.body.pull_request.head.sha;

    const response = await fetch("http://localhost:3009/github-api", {
        method: "post",
        headers: {
            "content-type": "application/json"
        },
        body: JSON.stringify({
            prId,
            repoName,
            username,
            commitSha
        })
    })

    res.send("hii");

});
//////////////////////////////////////////////////////////////////////////




app.post("/github-api", async (req, res) => {
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

        const filesWithContent = [];
        const allFindings = [];
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

            filesWithContent.push(currentFile);


            const language = detectLanguage(file.filename);
            const analyzer = selectAnalyzer(language);

            if (analyzer === "eslint") {
                const findings = await runStaticAnalyzer(currentFile);

                const normalizedFindings = normalizeFindings(
                    currentFile.filename,
                    findings.messages
                );
                allFindings.push(...normalizedFindings)

                if (normalizedFindings.length > 0) {
                    reviewPromises.push(
                        generateReview({
                            fileContent: currentFile.content,
                            findings: normalizedFindings,
                            diff: currentFile.diff
                        }).then((result) => {

                            const reviews = result.review.issues.map((issue, index) => ({
                                ...normalizedFindings[index],
                                ...issue
                            }));

                            return {
                                filename: currentFile.filename,
                                reviews,
                                usage: result.usage
                            };
                        })
                    );
                }

                //     const feed= {
                //         fileContent:currentFile.content,
                //         finding:normalizedFindings,
                //         diff:currentFile.diff
                //     }
                //     const result = await generateReview(feed)
                //     console.log("STRUCTURED REVIEW:");
                // console.log(result.review);

            }
        }

        // console.log("Files with source content:", filesWithContent);
        //         console.log("ALL FINDINGS:");
        // console.log(allFindings);
        const reviewResults = await Promise.all(reviewPromises);
        for (const fileReview of reviewResults) {

            let commentBody = `## 🤖 Code Review\n\n`;
            commentBody += `### ${fileReview.filename}\n\n`;

            const issues = fileReview.reviews.filter(
                review => review.isIssue
            );

            if (issues.length === 0) {
                continue;
            }


            for (const review of fileReview.reviews) {


                commentBody += `**${review.severity.toUpperCase()} — Line ${review.line}**\n\n`;

                commentBody += `${review.explanation}\n\n`;

                commentBody += `**Confidence:** ${(review.confidence * 100).toFixed(0)}%\n\n`;

                commentBody += `**Suggested fix:** ${review.suggestedFix}\n\n`;

                commentBody += `---\n\n`;
            }

            await fetch("http://localhost:3009/github-comment", {
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
        }
        console.log("ALL REVIEWS:");
        console.dir(reviewResults, { depth: null });
        return res.json(filesWithContent);

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            error: "Failed to retrieve PR files"
        });
    }
});
///////////////////////////////////////////////


app.post("/github-comment", async (req, res) => {
    try {
        const {
            prId,
            repoName,
            username,
            reviewBody
        } = req.body;

        const response = await fetch(
            `https://api.github.com/repos/${username}/${repoName}/issues/${prId}/comments`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    body: reviewBody
                })
            }
        );

        const data = await response.json();

        console.log("GitHub response:", data);

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        res.json({
            message: "Review comment created successfully",
            comment: data
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Failed to create review comment"
        });
    }
});


app.listen(3009, () => {
    console.log("listening")
})

