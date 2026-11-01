export function normalizeFindings(path, messages = []) {
    const findings = [];
    const parseErrors = [];

    for (const message of messages) {
        // Syntax errors have no rule id and are reported separately.
        if (message.fatal) {
            parseErrors.push(message.message);
            continue;
        }

        findings.push({
            source: "eslint",
            file: path,
            line: message.line,
            endLine: message.endLine ?? message.line,
            column: message.column,
            rule: message.ruleId,
            severity: message.severity === 2 ? "error" : "warning",
            message: message.message
        });
    }

    return { findings, parseErrors };
}

/**
 * Keep findings that START on a line this PR added (RIGHT side).
 * Anything else is old code, so it is not reported.
 */
export function keepChangedLines(findings, fileContext) {
    const added = new Set(
        fileContext.regions.flatMap(region => region.addedLines)
    );

    const kept = [];
    let dropped = 0;

    for (const finding of findings) {
        if (added.has(finding.line)) kept.push(finding);
        else dropped++;
    }

    return { kept, dropped };
}