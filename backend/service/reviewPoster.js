const GITHUB_API = "https://api.github.com";

function headers() {
    return {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
    };
}

const LABEL = { high: "High", medium: "Medium", low: "Low" };

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
        `<sub>Confidence: ${finding.confidence} · ${finding.category}</sub>`,
        `<!-- cr-fp:${finding.fingerprint} -->`
    );

    return lines.join("\n");
}

async function getExistingFingerprints(owner, repo, prId) {
    const found = new Set();

    try {
        const response = await fetch(
            `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prId}/comments?per_page=100`,
            { headers: headers() }
        );

        if (!response.ok) return found;

        for (const comment of await response.json()) {
            const match = String(comment.body ?? "").match(/cr-fp:([a-f0-9]+)/);
            if (match) found.add(match[1]);
        }
    } catch {
        // If this fails, the worst case is a duplicate comment.
    }

    return found;
}

export async function postReview({
    owner,
    repo,
    prId,
    headSha,
    summary,
    findings
}) {
    const existing = await getExistingFingerprints(owner, repo, prId);
    const fresh = findings.filter(f => !existing.has(f.fingerprint));

    if (fresh.length === 0) {
        return {
            mode: "none",
            posted: 0,
            duplicatesSkipped: findings.length
        };
    }

    const body =
        `## 🤖 Code review\n\n${summary}\n\n` +
        `${fresh.length} comment${fresh.length === 1 ? "" : "s"} below.`;

    const response = await fetch(
        `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prId}/reviews`,
        {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({
                commit_id: headSha,
                body,
                event: "COMMENT",
                comments: fresh.map(f => ({
                    path: f.path,
                    line: f.line,
                    side: f.side,
                    body: formatComment(f)
                }))
            })
        }
    );

    if (response.ok) {
        return {
            mode: "inline_review",
            posted: fresh.length,
            duplicatesSkipped: findings.length - fresh.length
        };
    }

    const error = await response.text();

    const fallbackBody =
        `## 🤖 Code review\n\n${summary}\n\n` +
        fresh
            .map(f =>
                `**${f.path}:${f.side === "LEFT" ? "L" : "R"}${f.line}**\n${formatComment(f)}`
            )
            .join("\n\n---\n\n");

    const fallback = await fetch(
        `${GITHUB_API}/repos/${owner}/${repo}/issues/${prId}/comments`,
        {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ body: fallbackBody })
        }
    );

    return {
        mode: fallback.ok ? "general_fallback" : "failed",
        posted: fallback.ok ? fresh.length : 0,
        inlineError: error.slice(0, 500)
    };
}