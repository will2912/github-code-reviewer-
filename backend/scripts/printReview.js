import fs from "node:fs";
import { collectPR } from "../service/prCollector.js";
import { buildReviewContext, isCommentable } from "../service/contextBuilder.js";
import { analyzeChangedFiles } from "../service/staticAnalyzer.js";

const args = process.argv.slice(2);
const showCode = !args.includes("--no-code");
const [owner, repo, prId] = args.filter(arg => !arg.startsWith("--"));

if (!owner || !repo || !prId) {
    console.log(
        "Usage: node --env-file=.env scripts/printreview.js <owner> <repo> <prNumber> [--no-code]"
    );
    process.exit(1);
}

const collected = await collectPR({ owner, repo, prId });
const context = buildReviewContext(collected);
const staticResults = await analyzeChangedFiles(collected.files, context);

const line = "=".repeat(70);
const totals = { error: 0, warning: 0, dropped: 0, invalid: 0 };

console.log(`PR: ${context.pr?.title}`);
console.log(`Files: ${context.files.length} | Skipped: ${context.skipped.length}`);

for (const file of context.files) {
    const analysis = staticResults[file.path];

    console.log(`\n${line}`);
    console.log(`${file.path}  (${file.language}, ${file.status}, parsed: ${file.parsedOk})`);
    console.log(
        `Regions: ${file.regions.length} | Blocks: ${file.blocks.length} | ` +
        `Trivial ignored: ${file.ignoredWhitespaceRegions}`
    );

    /* ---------- Context ---------- */
    if (showCode) {
        for (const block of file.blocks) {
            const symbols = block.symbols.length
                ? `, symbols: ${block.symbols.join(", ")}`
                : "";

            console.log(
                `\n--- ${block.id} (${block.version}, ${block.scope}, ` +
                `lines ${block.startLine}-${block.endLine}${symbols}) ---`
            );
            console.log(block.code);
        }
    }

    /* ---------- Static analysis ---------- */
    console.log("\nStatic analysis:");

    if (!analysis || analysis.skipped) {
        console.log(`  skipped: ${analysis?.reason ?? "no result"}`);
        continue;
    }

    if (analysis.parseErrors.length) {
        console.log(`  parse errors: ${analysis.parseErrors.join(" | ")}`);
    }

    if (analysis.findings.length === 0) {
        console.log("  no findings on added lines");
    }

    for (const finding of analysis.findings) {
        const valid = isCommentable(file, "RIGHT", finding.line);

        totals[finding.severity]++;
        if (!valid) totals.invalid++;

        console.log(
            `  [${finding.severity}] R${finding.line}  ${finding.rule}: ${finding.message}` +
            (valid ? "" : "   <-- NOT commentable")
        );
    }

    console.log(
        `  (ignored ${analysis.droppedPreexisting} finding(s) on lines this PR did not add)`
    );
    totals.dropped += analysis.droppedPreexisting;
}

if (context.skipped.length) {
    console.log(`\n${line}\nSkipped files:`);
    for (const item of context.skipped) {
        console.log(`  - ${item.path}: ${item.reason}`);
    }
}

console.log(`\n${line}`);
console.log(
    `Static analysis totals: ${totals.error} error(s), ${totals.warning} warning(s), ` +
    `${totals.dropped} pre-existing ignored, ${totals.invalid} not commentable`
);

fs.writeFileSync(
    "review-evidence.json",
    JSON.stringify({ context, staticResults }, null, 2)
);
console.log("Saved review-evidence.json");