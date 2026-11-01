import { saveReviewRun } from "../service/reviewStore.js";

const run = await saveReviewRun({
    username: "demo-user",
    repoName: "demo-repo",
    prId: 12,
    commitSha: "abc123def4567890",
    githubCommentPosted: true,
    files: [
        {
            filename: "src/app.js",
            language: "javascript",
            analyzerRan: true,
            findingCount: 2,
            usage: null,
            reviews: [
                {
                    file: "src/app.js",
                    line: 10,
                    column: 4,
                    rule: "no-undef",
                    message: "foo is not defined",
                    isIssue: true,
                    severity: "high",
                    confidence: 0.91,
                    explanation: "The code uses foo without declaring or importing it.",
                    suggestedFix: "Declare foo or import it from the correct module.",
                },
                {
                    file: "src/app.js",
                    line: 22,
                    column: 2,
                    rule: "no-unused-vars",
                    message: "bar is unused",
                    isIssue: false,
                    severity: "low",
                    confidence: 0.4,
                    explanation: "bar looks unused in this diff but may be reserved.",
                    suggestedFix: "Remove it if it is not needed.",
                },
            ],
        },
        {
            filename: "README.md",
            language: "unknown",
            analyzerRan: false,
            findingCount: 0,
            usage: null,
            reviews: [],
        },
    ],
});

console.log(`Seeded review run ${run.id}`);
process.exit(0);
