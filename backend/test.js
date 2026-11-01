import fs from "node:fs";
import { collectPR } from "./service/prCollector.js";
import { parsePatch } from "./service/patchParser.js";

function buildFileContext(file) {
    const { regions,commentableLines } = parsePatch(file.patch);
    // console.log("lines: ",commentableLines)
    // console.dir(regions, { depth: null });
    // return; 
}
//
function buildReviewContext(collected) {
    const files = [];
    const skipped = [...collected.skipped];

    for (const file of collected.files) {
        try {
            const fileContext = buildFileContext(file);

            if (fileContext.regions.length === 0) {
                skipped.push({ path: file.path, reason: "only whitespace/formatting changes" });
            } else {
                files.push(fileContext);
            }
        } catch (error) {
            skipped.push({ path: file.path, reason: `context build failed: ${error.message}` });
        }
    }

    return { pr: collected.pr, files, skipped };
}
///
const [owner, repo, prId] = process.argv.slice(2);

if (!owner || !repo || !prId) {
    console.log("Usage: node --env-file=.env scripts/printContext.js <owner> <repo> <prNumber>");
    process.exit(1);
}

const collected = await collectPR({ owner, repo, prId });
console.log(collected)

buildReviewContext(collected)

