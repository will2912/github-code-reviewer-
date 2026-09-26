export function normalizeFindings(filename, findings) {
    return findings.map((finding) => ({
        file: filename,
        line: finding.line,
        column: finding.column,
        rule: finding.ruleId,
        severity:
            finding.severity === 2
                ? "error"
                : finding.severity === 1
                ? "warning"
                : "info",
        message: finding.message
    }));
}