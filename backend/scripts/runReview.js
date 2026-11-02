import fs from "node:fs";
import { collectPR } from "../service/prCollector.js";
import { buildReviewContext } from "../service/contextBuilder.js";
import { analyzeChangedFiles } from "../service/staticAnalyzer.js";
import { buildReviewPrompt } from "../service/promptBuilder.js";
import { callLLM } from "../service/llmClient.js";
import { parseModelJson, validateFindings } from "../service/findingsValidator.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const [owner, repo, prId] = args.filter(arg => !arg.startsWith("--"));

if (!owner || !repo || !prId) {
    console.log(
        "Usage: node --env-file=.env scripts/runreview.js <owner> <repo> <prNumber> [--dry]"
    );
    process.exit(1);
}

const collected = await collectPR({ owner, repo, prId });
const context = buildReviewContext(collected);
const staticResults = await analyzeChangedFiles(collected.files, context);
const { messages, stats } = buildReviewPrompt(context, staticResults);

fs.writeFileSync(
    "prompt-output.txt",
    messages.map(m => `##### ${m.role.toUpperCase()} #####\n${m.content}`).join("\n\n")
);

console.log(
    `Prompt: ${stats.files} file(s), ~${stats.estimatedTokens} tokens` +
    (stats.omittedFiles.length ? `, omitted for size: ${stats.omittedFiles.join(", ")}` : "")
);
console.log("Saved prompt-output.txt");

if (dryRun) {
    console.log("Dry run: the model was not called.");
    process.exit(0);
}

const { content: raw, usage } = await callLLM(messages);
console.log("Token usage:", usage);
fs.writeFileSync("llm-raw-output.txt", raw);

const parsed = parseModelJson(raw);

if (!parsed.ok) {
    console.log(`Could not read the model output: ${parsed.error}`);
    console.log("See llm-raw-output.txt");
    process.exit(1);
}

const result = validateFindings(parsed.value, context);

console.log(`\nSummary: ${result.summary}`);
console.log(`\nAccepted findings: ${result.accepted.length}`);

for (const f of result.accepted) {
    const where = `${f.path}:${f.side === "LEFT" ? "L" : "R"}${f.line}`;
    const moved = f.relocatedFrom ? ` (moved from line ${f.relocatedFrom})` : "";

    console.log(`\n[${f.severity}/${f.confidence}] ${where}${moved}`);
    console.log(`  ${f.title}`);
    console.log(`  ${f.message}`);
    if (f.suggestion) console.log(`  Fix: ${f.suggestion}`);
}

console.log(`\nRejected: ${result.rejected.length}`);

for (const r of result.rejected) {
    console.log(`  - ${r.reason}: ${r.finding?.path}:${r.finding?.line} ${r.finding?.title ?? ""}`);
}

if (result.needsMoreContext.length > 0) {
    console.log("\nThe model wanted more context:");
    for (const item of result.needsMoreContext) {
        console.log(`  - ${item.path}: ${item.why}`);
    }
}

fs.writeFileSync("review-result.json", JSON.stringify(result, null, 2));
console.log("\nSaved review-result.json (nothing was posted to GitHub)");