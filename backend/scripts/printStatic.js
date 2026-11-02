import { collectPR } from "../service/prCollector.js";
import { parsePatch } from "../service/patchParser.js";
import { runStaticAnalyzer } from "../service/staticAnalyzer.js";
import { normalizeFindings } from "../service/findingNormalizer.js";

const args = process.argv.slice(2);
const newOnly = args.includes("--new-only");
const [owner, repo, prId] = args.filter(arg => !arg.startsWith("--"));

if (!owner || !repo || !prId) {
    console.log(
        "Usage: node --env-file=.env scripts/printstatic.js <owner> <repo> <prNumber> [--new-only]"
    );
    process.exit(1);
}

const collected = await collectPR({ owner, repo, prId });

const line = "=".repeat(70);
const totals = { new: 0, old: 0, error: 0, warning: 0, parseErrors: 0 };

console.log(`PR: ${collected.pr?.title}`);
console.log(`Files collected: ${collected.files.length}`);

for (const file of collected.files) {
    console.log(`\n${line}`);
    console.log(`${file.path}  (${file.status})`);

    const run = await runStaticAnalyzer({
        path: file.path,
        content: file.content ?? null
    });

    if (run.skipped) {
        console.log(`  skipped: ${run.reason}`);
        continue;
    }

    const { findings, parseErrors } = normalizeFindings(file.path, run.messages);

    // Lines this PR added (new-file numbers)
    const addedLines = new Set(
        parsePatch(file.patch).regions.flatMap(region => region.addedLines)
    );

    if (parseErrors.length) {
        totals.parseErrors += parseErrors.length;
        console.log(`  parse errors: ${parseErrors.join(" | ")}`);
    }

    const shown = findings
        .map(finding => ({ ...finding, isNew: addedLines.has(finding.line) }))
        .filter(finding => !newOnly || finding.isNew)
        .sort((a, b) => a.line - b.line);

    if (shown.length === 0) {
        console.log(newOnly ? "  no findings on added lines" : "  no findings");
        continue;
    }

    for (const finding of shown) {
        totals[finding.isNew ? "new" : "old"]++;
        totals[finding.severity]++;

        console.log(
            `  [${finding.isNew ? "NEW" : "old"}] [${finding.severity}] ` +
            `line ${finding.line}  ${finding.rule}: ${finding.message}`
        );
    }
}

console.log(`\n${line}`);
console.log(
    `Totals: ${totals.new} on added lines, ${totals.old} on old lines | ` +
    `${totals.error} error(s), ${totals.warning} warning(s) | ` +
    `${totals.parseErrors} parse error(s)`
);