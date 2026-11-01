import crypto from "node:crypto";
import { isCommentable } from "./contextBuilder.js";

const RANK = { low: 1, medium: 2, high: 3 };
// The model gives a number from 0 to 100. Words are still accepted.
function parseConfidence(value) {
    let n =
        typeof value === "number"
            ? value
            : Number.parseFloat(String(value ?? "").replace("%", ""));

    if (Number.isFinite(n)) {
        if (n > 0 && n <= 1) n *= 100;
        return Math.round(Math.min(100, Math.max(0, n)));
    }

    const words = { high: 90, medium: 65, low: 35 };
    return words[String(value ?? "").toLowerCase()] ?? null;
}

const levelOf = percent => (percent >= 80 ? "high" : percent >= 50 ? "medium" : "low");
const ROW_RE = /^([+\- ])([RL ])\s*(\d+) \| (.*)$/;
const NEARBY = [0, 1, -1, 2, -2, 3, -3];

const compact = text => String(text ?? "").replace(/\s+/g, "");

export function parseModelJson(text) {
    if (typeof text !== "string" || !text.trim()) {
        return { ok: false, error: "empty response" };
    }

    let body = text.trim();
    const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) body = fenced[1].trim();

    const first = body.indexOf("{");
    const last = body.lastIndexOf("}");

    if (first === -1 || last <= first) {
        return { ok: false, error: "no JSON object found" };
    }

    try {
        return { ok: true, value: JSON.parse(body.slice(first, last + 1)) };
    } catch (error) {
        return { ok: false, error: `invalid JSON: ${error.message}` };
    }
}

// Map "R42" / "L42" -> the code text of that row, for commentable rows only.
function indexRows(fileContext) {
    const rows = new Map();

    for (const block of fileContext.blocks) {
        for (const row of block.code.split("\n")) {
            const match = row.match(ROW_RE);
            if (!match || match[2] === " ") continue;
            rows.set(`${match[2]}${Number(match[3])}`, match[4]);
        }
    }

    return rows;
}

function fingerprint(path, side, evidence) {
    return crypto
        .createHash("sha1")
        .update([path, side, compact(evidence.split("\n")[0])].join("|"))
        .digest("hex")
        .slice(0, 12);
}

const LOG_RE = /\bconsole\.(log|debug|info|trace)\s*\(/;
const SENSITIVE_CODE_RE =
    /token|secret|password|passwd|credential|cookie|session|authorization|headers?|body|\burl\b|\bquery\b|\buser\b|\bemail\b|\bkey\b|\brequest\b|\breq\b/i;

// A log of non-sensitive values is never more than "low".
function calibrate(finding) {
    if (
        LOG_RE.test(finding.evidence) &&
        !SENSITIVE_CODE_RE.test(finding.evidence) &&
        RANK[finding.severity] > RANK.low
    ) {
        return { ...finding, severity: "low", calibrated: true };
    }

    return finding;
}

export function validateFindings(
    modelOutput,
    context,
    { minConfidence = 50, maxFindings = 10 } = {}
) {
    const files = new Map(
        context.files.map(file => [
            file.path,
            {
                file,
                rows: indexRows(file),
                changed: {
                    RIGHT: new Set(file.regions.flatMap(r => r.addedLines)),
                    LEFT: new Set(file.regions.flatMap(r => r.removedLines))
                }
            }
        ])
    );

    const accepted = [];
    const rejected = [];
    const seen = new Set();
    const list = Array.isArray(modelOutput?.findings) ? modelOutput.findings : [];

    for (const raw of list) {
        const reject = reason => rejected.push({ reason, finding: raw });

        if (!raw || typeof raw !== "object") { reject("not an object"); continue; }

        const entry = files.get(raw.path);
        if (!entry) { reject("file is not in the review context"); continue; }

        const side = raw.side === "LEFT" ? "LEFT" : raw.side === "RIGHT" ? "RIGHT" : null;
        const line = Number(raw.line);
        if (!side || !Number.isInteger(line)) { reject("bad line or side"); continue; }

        if (!RANK[raw.severity]) { reject("bad severity"); continue; }

        const confidence = parseConfidence(raw.confidence);
        if (confidence === null) { reject("bad confidence"); continue; }
        if (confidence < minConfidence) { reject("confidence too low"); continue; }

        const message = String(raw.message ?? "").trim();
        if (message.length < 10) { reject("message missing or too short"); continue; }

        const evidence = String(raw.evidence ?? "").trim();
        const needle = compact(evidence.split("\n")[0]);
        if (needle.length < 4) { reject("evidence missing or too short to verify"); continue; }

        // The quoted code must appear at, or within 3 lines of, the cited line.
        const prefix = side === "LEFT" ? "L" : "R";
        const hits = NEARBY
            .map(offset => line + offset)
            .filter(n => {
                const text = entry.rows.get(`${prefix}${n}`);
                return text !== undefined && compact(text).includes(needle);
            });

        if (hits.length === 0) { reject("evidence not found at or near the cited line"); continue; }

        // It must also be a line this pull request changed.
        const found = hits.find(n => entry.changed[side].has(n));
        if (found === undefined) { reject("cited line is unchanged (pre-existing) code"); continue; }

        if (!isCommentable(entry.file, side, found)) { reject("line is not commentable"); continue; }

        const category = String(raw.category ?? "bug");
        const print = fingerprint(raw.path, side, evidence);
        if (seen.has(print)) { reject("duplicate finding"); continue; }
        seen.add(print);

        accepted.push(calibrate({
            path: raw.path,
            line: found,
            side,
            severity: raw.severity,
            confidence,
            confidenceLevel: levelOf(confidence),
            category,
            title: String(raw.title ?? "").trim().slice(0, 120) || message.slice(0, 80),
            message,
            suggestion: raw.suggestion ? String(raw.suggestion).trim() : null,
            evidence,
            relocatedFrom: found !== line ? line : null,
            fingerprint: print
        }));
    }

    accepted.sort(
        (a, b) =>
            RANK[b.severity] - RANK[a.severity] ||
            b.confidence - a.confidence ||
            a.line - b.line
    );

    for (const extra of accepted.splice(maxFindings)) {
        rejected.push({ reason: "over the findings limit", finding: extra });
    }

    return {
        summary: String(modelOutput?.summary ?? ""),
        accepted,
        rejected,
        needsMoreContext: Array.isArray(modelOutput?.needsMoreContext)
            ? modelOutput.needsMoreContext
            : []
    };
}