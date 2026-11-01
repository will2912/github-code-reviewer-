const GITHUB_API = "https://api.github.com";

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };
const LABEL = { high: "High", medium: "Medium", low: "Low" };

function headers() {
    return {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
    };
}

const sideLetter = side => (side === "LEFT" ? "L" : "R");

/** The text of one inline comment. */
export function formatComment(finding) {
    const lines = [
        `**${LABEL[finding.severity]} · ${finding.title}**`,
        "",
        finding.message
    ];

    if (finding.suggestion) {
        lines.push("", `**Suggested fix:** ${finding.suggestion}`);
    }

    lines.push(
        "",
        `<sub>Confidence: ${finding.confidence}% · ${finding.category}</sub>`,
        `<!-- cr-fp:${finding.fingerprint} -->`
    );

    return lines.join("\n");
}

/** Medium and high go inline. Security always goes inline. The rest is summarised. */
export function splitFindings(findings) {
    const inline = [];
    const minor = [];

    for (const finding of findings) {
        const important =
            SEVERITY_RANK[finding.severity] >= SEVERITY_RANK.medium ||
            finding.category === "security";

        (important ? inline : minor).push(finding);
    }

    return { inline, minor };
}

/** The general comment, written from the findings (not by the model). */
export function buildSummary(inline, minor) {
    const all = [...inline, ...minor];
    const count = severity => all.filter(f => f.severity === severity).length;

    const out = [
        "## 🤖 Code review",
        "",
        `Found **${all.length}** ${all.length === 1 ? "issue" : "issues"}: ` +
        `${count("high")} high, ${count("medium")} medium, ${count("low")} low.`
    ];

    if (inline.length > 0) {
        out.push(
            "",
            `${inline.length} ${inline.length === 1 ? "comment is" : "comments are"} on the code lines.`
        );
    }

    if (minor.length > 0) {
        out.push("", "**Minor notes** (low severity):");

        for (const f of minor) {
            const where = f.side === "LEFT" ? `old line ${f.line}` : `line ${f.line}`;

            out.push(
                `- \`${f.path}\` ${where}: ${f.title} (confidence ${f.confidence}%) ` +
                `<!-- cr-fp:${f.fingerprint} -->`
            );
        }
    }

    return out.join("\n");
}

// Markers of everything this bot has already posted on the PR.
async function getExistingFingerprints(owner, repo, prId) {
    const found = new Set();
    const base = `${GITHUB_API}/repos/${owner}/${repo}`;

    const urls = [
        `${base}/pulls/${prId}/comments?per_page=100`,   // inline comments
        `${base}/pulls/${prId}/reviews?per_page=100`,    // review summaries
        `${base}/issues/${prId}/comments?per_page=100`   // general comments
    ];

    await Promise.all(
        urls.map(async url => {
            try {
                const response = await fetch(url, { headers: headers() });
                if (!response.ok) return;

                for (const item of await response.json()) {
                    for (const match of String(item.body ?? "").matchAll(/cr-fp:([a-f0-9]+)/g)) {
                        found.add(match[1]);
                    }
                }
            } catch {
                // Worst case: a duplicate comment.
            }
        })
    );

    return found;
}

export async function postReview({ owner, repo, prId, headSha, findings }) {
    const base = `${GITHUB_API}/repos/${owner}/${repo}`;

    const existing = await getExistingFingerprints(owner, repo, prId);
    const fresh = findings.filter(f => !existing.has(f.fingerprint));
    const duplicatesSkipped = findings.length - fresh.length;

    if (fresh.length === 0) {
        return { mode: "none", posted: 0, duplicatesSkipped };
    }

    const { inline, minor } = splitFindings(fresh);
    const body = buildSummary(inline, minor);

    const response = await fetch(`${base}/pulls/${prId}/reviews`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            commit_id: headSha,
            body,
            event: "COMMENT",
            comments: inline.map(f => ({
                path: f.path,
                line: f.line,
                side: f.side,
                body: formatComment(f)
            }))
        })
    });

    if (response.ok) {
        return {
            mode: inline.length > 0 ? "inline_review" : "summary_only",
            posted: fresh.length,
            inline: inline.length,
            summarized: minor.length,
            duplicatesSkipped
        };
    }

    // GitHub rejected the review (for example a 422 on a line). Post one general
    // comment instead, so the findings are not lost.
    const error = await response.text();

    const fallbackBody =
        body +
        inline
            .map(
                f =>
                    `\n\n---\n\n**\`${f.path}\` ${sideLetter(f.side)}${f.line}**\n\n${formatComment(f)}`
            )
            .join("");

    const fallback = await fetch(`${base}/issues/${prId}/comments`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ body: fallbackBody })
    });

    return {
        mode: fallback.ok ? "general_fallback" : "failed",
        posted: fallback.ok ? fresh.length : 0,
        duplicatesSkipped,
        inlineError: error.slice(0, 500)
    };
}