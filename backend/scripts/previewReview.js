import fs from "node:fs";
import { collectPR } from "../service/prCollector.js";
import { buildReviewContext, isCommentable } from "../service/contextBuilder.js";
import { analyzeChangedFiles } from "../service/staticAnalyzer.js";
import { runReviewWithRetrieval } from "../service/retrievalLoop.js";
import { formatComment } from "../service/reviewPoster.js";

const [owner, repo, prId] = process.argv.slice(2).filter(arg => !arg.startsWith("--"));

if (!owner || !repo || !prId) {
    console.log("Usage: node --env-file=.env scripts/previewreview.js <owner> <repo> <prNumber>");
    process.exit(1);
}

const line = "=".repeat(70);
const label = r => (r.type === "symbol" ? `symbol ${r.name}` : `file ${r.path}`);

const collected = await collectPR({ owner, repo, prId });
const context = buildReviewContext(collected);

if (context.files.length === 0) {
    console.log("Nothing to review (every file was skipped).");
    process.exit(0);
}

const staticResults = await analyzeChangedFiles(collected.files, context);
const result = await runReviewWithRetrieval({ owner, repo, collected, context, staticResults });

if (result.status !== "ok") {
    console.log(`Review failed: ${result.status} - ${result.error ?? ""}`);
    if (result.raw) fs.writeFileSync("llm-raw-output.txt", result.raw);
    process.exit(1);
}

/* ---------------- Rounds ---------------- */
console.log(line);
console.log("RETRIEVAL ROUNDS");
console.log(line);

for (const round of result.rounds) {
    if (round.error) {
        console.log(`\nRound ${round.round}: unreadable output (${round.error})`);
        continue;
    }

    console.log(
        `\nRound ${round.round}: ${round.accepted} accepted, ${round.rejected} rejected, ` +
        `${round.tokens ?? "?"} tokens`
    );

    for (const request of round.requests) {
        console.log(`  asked for: ${label(request)}${request.why ? ` - ${request.why}` : ""}`);
    }

    for (const item of round.retrievedNow) {
        const where = item.ranges.map(r => `${r.startLine}-${r.endLine}`).join(", ");
        console.log(
            `  fetched:   ${item.path}${item.symbol ? ` [${item.symbol}]` : ""} ` +
            `(lines ${where}, ${item.chars} chars${item.cached ? ", already in memory" : ""})`
        );
    }

    for (const item of round.unavailableNow) {
        console.log(`  UNAVAILABLE: ${item.label} - ${item.reason}`);
    }
}

console.log(`\nStopped because: ${result.stopReason}`);
console.log(`GitHub API calls used: ${result.fetches}`);
console.log(
    `Tokens: ${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion ` +
    `= ${result.usage.totalTokens}`
);

/* ---------------- Change from round 1 ---------------- */
const show = (name, list) => {
    console.log(`  ${name}: ${list.length}`);
    for (const f of list) console.log(`     - ${f.path}:${f.side === "LEFT" ? "L" : "R"}${f.line} ${f.title}`);
};

console.log(`\n${line}\nRETRIEVAL EFFECT (round 1 vs final)\n${line}`);
show("confirmed", result.changes.confirmed);
show("dropped after retrieval", result.changes.dropped);
show("added after retrieval", result.changes.added);

/* ---------------- Final comments ---------------- */
console.log(`\n${line}\nFINAL COMMENTS (as they would be posted)\n${line}`);
console.log(`\nReview summary:\n  ${result.summary}`);

if (result.accepted.length === 0) {
    console.log("\n(no comments)");
}

const byFile = new Map();
for (const f of result.accepted) {
    if (!byFile.has(f.path)) byFile.set(f.path, []);
    byFile.get(f.path).push(f);
}

for (const [path, findings] of byFile) {
    const fileContext = context.files.find(file => file.path === path);

    console.log(`\n${path}`);

    for (const f of findings) {
        const valid = fileContext ? isCommentable(fileContext, f.side, f.line) : false;
        const body = formatComment(f).replace(/\n?<!-- cr-fp:[a-f0-9]+ -->/, "");

        console.log(`\n  ${f.side === "LEFT" ? "L" : "R"}${f.line}   commentable: ${valid ? "yes" : "NO"}`);
        console.log(body.split("\n").map(row => `  | ${row}`).join("\n"));
    }
}

/* ---------------- Rejected ---------------- */
console.log(`\n${line}\nREJECTED: ${result.rejected.length}\n${line}`);

for (const r of result.rejected) {
    console.log(`  - ${r.reason}: ${r.finding?.path}:${r.finding?.line} ${r.finding?.title ?? ""}`);
}

if (result.needsMoreContext.length > 0) {
    console.log("\nStill unverified after the last round:");
    for (const item of result.needsMoreContext) {
        console.log(`  - ${item.name ?? item.path}: ${item.why}`);
    }
}

fs.writeFileSync("retrieval-result.json", JSON.stringify(result, null, 2));
console.log(`\n${line}\nNOTHING WAS POSTED TO GITHUB. Saved retrieval-result.json\n${line}`);