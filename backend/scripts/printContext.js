
import fs from "node:fs";
import { collectPR } from "../service/prCollector.js";
import { buildReviewContext } from "../service/contextBuilder.js";

const [owner, repo, prId] = process.argv.slice(2);

if (!owner || !repo || !prId) {
    console.log(
        "Usage: node --env-file=.env scripts/printContext.js <owner> <repo> <prNumber>"
    );
    process.exit(1);
}

const collected = await collectPR({ owner, repo, prId });
const context = buildReviewContext(collected);

fs.writeFileSync(
    "context-output.json",
    JSON.stringify(context, null, 2)
);

console.log(`PR: ${context.pr?.title ?? "Unknown"}`);
console.log(`Head SHA: ${context.pr?.headSha ?? "Unknown"}`);
console.log(
    `Files: ${context.files.length} | Skipped: ${context.skipped.length}\n`
);

function printContextLines(label, lines = []) {
    if (lines.length === 0) return;

    console.log(`  ${label}:`);

    for (const item of lines) {
        const lineNumber = item.line ?? item.newLine ?? item.oldLine ?? "?";
        const content = item.text ?? item.content ?? "";

        console.log(`     ${lineNumber} | ${content}`);
    }
}

for (const file of context.files) {
    console.log("=".repeat(70));

    console.log(
        `${file.path} (parsed: ${file.parsedOk}, ` +
        `regions: ${file.regions.length}, ` +
        `whitespace-only ignored: ${file.ignoredWhitespaceRegions})`
    );

    console.log("\nCommentable lines:");
    console.log("  LEFT  (old file):", file.commentableLines.left);
    console.log("  RIGHT (new file):", file.commentableLines.right);

    for (const region of file.regions) {
        const fn = file.functions.find(
            item => item.id === region.functionId
        );

        console.log(`\n  Region ${region.id}`);
        console.log(`  Hunk: ${region.hunkIndex}`);

        console.log(
            `  New-file lines: ${region.startLine}-${region.endLine}`
        );

        console.log(
            `  Old-file lines: ${region.oldStartLine}-${region.oldEndLine}`
        );

        console.log(`  Context version: ${region.version ?? "head"}`);
        console.log(`  Context status: ${region.contextStatus ?? "unknown"}`);

        if (region.contextWarning) {
            console.log(`  Warning: ${region.contextWarning}`);
        }

        if (region.isPureDeletion) {
            console.log("  Type: deletion only");
        } else if (region.isPureAddition) {
            console.log("  Type: addition only");
        } else {
            console.log("  Type: modification");
        }

        console.log(
            `  Enclosing: ${
                fn
                    ? `${fn.name} (${fn.startLine}-${fn.endLine})`
                    : "none (top level or unresolved)"
            }`
        );

        console.log(
            `  Added: ${region.added.length} | Removed: ${region.removed.length}`
        );

        for (const line of region.added) {
            console.log(`    +${line.line} | ${line.text}`);
        }

        for (const line of region.removed) {
            console.log(`    -${line.line} | ${line.text}`);
        }

        printContextLines("Context before", region.contextBefore);
        printContextLines("Context after", region.contextAfter);

        console.log(`  Code shown in: ${region.blockId ?? "none"}`);
    }

    for (const block of file.blocks) {
        console.log(
            `\n  --- ${block.id} (${block.version ?? "head"} version, ` +
            `lines ${block.startLine}-${block.endLine}) ---`
        );

        console.log(block.code);
    }

    console.log("\n  Parsed diff hunks:");

    for (const hunk of file.hunks) {
        console.log(
            `  Hunk ${hunk.index}: ` +
            `old ${hunk.oldStartLine},${hunk.oldLineCount} -> ` +
            `new ${hunk.newStartLine},${hunk.newLineCount}`
        );
    }
}

if (context.skipped.length > 0) {
    console.log("\nSkipped files:");

    for (const file of context.skipped) {
        console.log(`  - ${file.path}: ${file.reason}`);
    }
}

console.log("\nFull context saved to context-output.json");
