
import { detectLanguage } from "./languageDetector.js";
import { parsePatch } from "./patchParser.js";
import { getStructureRanges, findBlockForRegion } from "./astAnalyzer.js";

const SMALL_FUNCTION_LINES = 80;
const SMALL_DECLARATION_LINES = 40;
const WINDOW_AROUND_REGION = 15;
const TOP_LEVEL_WINDOW = 8;
const FALLBACK_WINDOW = 30;
const MAX_DIFF_ONLY_LINES = 120;
const MERGE_GAP = 10;

export const CODE_FORMAT_LEGEND =
    "Each code row is: <marker><label> | <code>. " +
    "Marker: '+' added line, '-' removed line, ' ' unchanged. " +
    "Label: R<n> = line n of the NEW file (RIGHT side), " +
    "L<n> = line n of the OLD file (LEFT side), " +
    "a bare number = shown for context only, NOT commentable. " +
    "Inline comments: side RIGHT + the R number for '+' and unchanged rows; " +
    "side LEFT + the L number for '-' rows.";

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function splitLines(content = "") {
    const lines = content.split(/\r?\n/);
    if (lines.length > 1 && lines.at(-1) === "") lines.pop();
    return lines;
}

function clampRange(start, end, min, max) {
    const from = Math.max(min, start);
    const to = Math.min(max, end);
    return { start: Math.min(from, to), end: to };
}

function formatRow(marker, side, number, width, commentable, text) {
    const label = (commentable ? side : " ") + String(number).padStart(width);
    return `${marker}${label} | ${text}`;
}

/* ------------------------------------------------------------------ */
/* Trivial-change detection (whitespace / formatting / comments)       */
/* ------------------------------------------------------------------ */

const DIRECTIVE_RE =
    /eslint-|@ts-(?:ignore|expect-error|nocheck|check)|istanbul|c8 ignore|prettier-ignore|webpackChunkName/i;

function findLineCommentStart(text) {
    let quote = null;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (quote) {
            if (ch === "\\") { i++; continue; }
            if (ch === quote) quote = null;
            continue;
        }

        if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
        if (ch === "/" && text[i + 1] === "/") return i;
    }

    return -1;
}

function isBlockCommentLine(trimmed) {
    return (
        /^\/\*.*\*\/$/.test(trimmed) ||
        /^\{\s*\/\*.*\*\/\s*\}$/.test(trimmed) ||
        /^\/\*\*?/.test(trimmed) ||
        /^\*\/?(\s|$)/.test(trimmed)
    );
}

function stripComments(text) {
    const trimmed = text.trim();
    if (!trimmed) return "";
    if (isBlockCommentLine(trimmed)) return "";

    const index = findLineCommentStart(text);
    return index === -1 ? text : text.slice(0, index);
}

function normalizeCode(texts) {
    return texts
        .map(stripComments)
        .join(" ")
        .replace(/\s+/g, " ")
        .replace(/\s*([^\w\s])\s*/g, "$1")
        .trim();
}

/**
 * Returns a reason string when the region changes only whitespace,
 * formatting or comments. Returns null when it needs review.
 * Heuristic: it does not run a full tokenizer.
 */
function getTrivialReason(region) {
    const added = (region.added ?? []).map(item => String(item.text ?? ""));
    const removed = (region.removed ?? []).map(item => String(item.text ?? ""));

    if ([...added, ...removed].some(text => DIRECTIVE_RE.test(text))) {
        return null;
    }

    const addedNorm = normalizeCode(added);
    const removedNorm = normalizeCode(removed);

    if (addedNorm !== removedNorm) return null;

    return addedNorm === ""
        ? "comments_or_blank_lines_only"
        : "whitespace_or_comment_only";
}

/* ------------------------------------------------------------------ */
/* Deleted functions (pure deletions)                                  */
/* ------------------------------------------------------------------ */

function findDeletedSymbols(region, base) {
    if (!base?.structure?.ok || region.removedLines.length === 0) return [];

    const first = Math.min(...region.removedLines);
    const last = Math.max(...region.removedLines);

    const inside = base.structure.ranges.filter(
        range =>
            (range.kind === "function" || range.kind === "method") &&
            range.named &&
            range.startLine >= first &&
            range.endLine <= last
    );

    const outermost = inside.filter(
        range =>
            !inside.some(
                other =>
                    other !== range &&
                    other.startLine <= range.startLine &&
                    other.endLine >= range.endLine &&
                    (other.startLine < range.startLine ||
                        other.endLine > range.endLine)
            )
    );

    return [...new Set(outermost.map(range => range.name))];
}

/* ------------------------------------------------------------------ */
/* Decide what to show for one region                                  */
/* ------------------------------------------------------------------ */

function planRegion(region, ctx) {
    const { file, headLines, headContent, headStructure, getBase } = ctx;
    const total = headLines ? headLines.length : 0;

    // No head file (deleted file, or its content could not be loaded).
    if (!headLines || total === 0) {
        const deleted = file.status === "removed";

        return {
            mode: "diff_only",
            scope: deleted ? "deleted_file" : "head_unavailable",
            version: deleted ? "base" : "diff",
            warning: deleted
                ? null
                : "Head file content unavailable; only diff lines are shown."
        };
    }

    const hasAdded = region.addedLines.length > 0;
    let regionStart;
    let regionEnd;
    let candidates;

    if (hasAdded) {
        regionStart = Math.min(...region.addedLines);
        regionEnd = Math.max(...region.addedLines);
        candidates = [region.addedLines];
    } else {
        // Pure deletion: removed lines belong just before this head line.
        const anchor = region.newRange?.startLine ?? 1;
        const after = Math.min(Math.max(anchor, 1), total);
        const before = Math.max(1, Math.min(anchor - 1, total));

        regionStart = before;
        regionEnd = after;
        candidates = [[after], [before]];
    }

    const deletedSymbols = region.isPureDeletion
        ? findDeletedSymbols(region, getBase())
        : [];

    let block = null;

    // When whole functions were deleted, the next function is unrelated,
    // so use a plain window around the deletion point instead.
    if (headStructure?.ok && deletedSymbols.length === 0) {
        for (const lines of candidates) {
            const result = findBlockForRegion(headContent, headStructure, {
                startLine: Math.min(...lines),
                endLine: Math.max(...lines),
                changedLines: lines
            });

            if (result.ok) {
                block = result.block;
                break;
            }
        }
    }

    const parsedOk = Boolean(headStructure?.ok);
    const isFunction =
        block && (block.kind === "function" || block.kind === "method");

    let range;
    let scope;

    if (isFunction) {
        const size = block.endLine - block.startLine + 1;

        if (size <= SMALL_FUNCTION_LINES) {
            range = clampRange(block.startLine, block.endLine, 1, total);
            scope = "function";
        } else {
            range = clampRange(
                regionStart - WINDOW_AROUND_REGION,
                regionEnd + WINDOW_AROUND_REGION,
                block.startLine,
                Math.min(block.endLine, total)
            );
            scope = "function_excerpt";
        }
    } else if (block) {
        const size = block.endLine - block.startLine + 1;
        const window = clampRange(
            regionStart - TOP_LEVEL_WINDOW,
            regionEnd + TOP_LEVEL_WINDOW,
            1,
            total
        );

        range =
            size <= SMALL_DECLARATION_LINES
                ? {
                    start: Math.min(window.start, block.startLine),
                    end: Math.max(window.end, block.endLine)
                }
                : clampRange(
                    window.start,
                    window.end,
                    block.startLine,
                    Math.min(block.endLine, total)
                );

        scope = "declaration";
    } else {
        const size = parsedOk ? TOP_LEVEL_WINDOW : FALLBACK_WINDOW;

        range = clampRange(regionStart - size, regionEnd + size, 1, total);
        scope = parsedOk ? "top_level_window" : "parse_failed_window";
    }

    return {
        mode: "head",
        scope,
        version: "head",
        range,
        deletedSymbols,
        fn: isFunction
            ? {
                symbol: block.symbol,
                kind: block.kind,
                startLine: block.startLine,
                endLine: block.endLine
            }
            : null
    };
}

/* ------------------------------------------------------------------ */
/* Merge ranges and render code                                        */
/* ------------------------------------------------------------------ */

function mergeRanges(items) {
    const sorted = [...items].sort(
        (a, b) => a.start - b.start || a.end - b.end
    );
    const merged = [];

    for (const item of sorted) {
        const last = merged.at(-1);

        if (last && item.start <= last.end + 1 + MERGE_GAP) {
            last.end = Math.max(last.end, item.end);
            last.members.push(...item.members);
        } else {
            merged.push({
                start: item.start,
                end: item.end,
                members: [...item.members]
            });
        }
    }

    return merged;
}

function renderHeadBlock(merged, headLines, rightSet) {
    const addedSet = new Set();
    const removedAt = new Map();
    let maxOld = 0;

    for (const { region } of merged.members) {
        for (const line of region.addedLines) addedSet.add(line);

        if (region.removed.length > 0) {
            const anchor = region.newRange.startLine;

            if (!removedAt.has(anchor)) removedAt.set(anchor, []);
            removedAt.get(anchor).push(...region.removed);

            for (const item of region.removed) {
                maxOld = Math.max(maxOld, item.line);
            }
        }
    }

    const width = String(Math.max(merged.end, maxOld)).length;
    const rows = [];

    const emitRemoved = anchor => {
        for (const item of removedAt.get(anchor) ?? []) {
            rows.push(formatRow("-", "L", item.line, width, true, item.text));
        }
    };

    for (let n = merged.start; n <= merged.end; n++) {
        emitRemoved(n);

        const isAdded = addedSet.has(n);

        rows.push(
            formatRow(
                isAdded ? "+" : " ",
                "R",
                n,
                width,
                isAdded || rightSet.has(n),
                headLines[n - 1]
            )
        );
    }

    emitRemoved(merged.end + 1);

    return {
        code: rows.join("\n"),
        includesRemovedLines: removedAt.size > 0
    };
}

function renderDiffOnly(region) {
    const rows = region.diff.map(item =>
        item.type === "added"
            ? { marker: "+", side: "R", n: item.newLine, text: item.content }
            : { marker: "-", side: "L", n: item.oldLine, text: item.content }
    );

    const shown = rows.slice(0, MAX_DIFF_ONLY_LINES);
    const width = String(Math.max(1, ...shown.map(row => row.n))).length;

    const out = shown.map(row =>
        formatRow(row.marker, row.side, row.n, width, true, row.text)
    );

    if (rows.length > shown.length) {
        out.push(`  ... ${rows.length - shown.length} more changed lines not shown`);
    }

    return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* One file                                                            */
/* ------------------------------------------------------------------ */

function buildFileContext(file) {
    const path = file.path;
    const parsed = parsePatch(file.patch);

    const regions = [];
    const trivialRegions = [];

    for (const region of parsed.regions) {
        const reason = getTrivialReason(region);

        if (reason) {
            trivialRegions.push({
                id: `${path}#${region.id}`,
                newRange: region.isPureDeletion ? null : region.newRange,
                oldRange: region.isPureAddition ? null : region.oldRange,
                reason
            });
        } else {
            regions.push(region);
        }
    }

    const headContent = typeof file.content === "string" ? file.content : null;
    const headLines = headContent === null ? null : splitLines(headContent);
    const headStructure =
        headContent === null ? null : getStructureRanges(headContent, path);
    const rightSet = new Set(parsed.commentableLines.right);

    // The base file is parsed only when a pure deletion needs it.
    let baseCache;
    const getBase = () => {
        if (baseCache !== undefined) return baseCache;

        baseCache =
            typeof file.baseContent === "string"
                ? {
                    structure: getStructureRanges(
                        file.baseContent,
                        file.basePath ?? path
                    )
                }
                : null;

        return baseCache;
    };

    const ctx = { file, headLines, headContent, headStructure, getBase };

    const prepared = regions.map(region => ({
        region,
        plan: planRegion(region, ctx)
    }));

    const merged = mergeRanges(
        prepared
            .filter(item => item.plan.mode === "head")
            .map(item => ({
                start: item.plan.range.start,
                end: item.plan.range.end,
                members: [item]
            }))
    );

    const blocks = [];
    const blockIdByRegion = new Map();

    for (const group of merged) {
        const id = `${path}#block${blocks.length + 1}`;
        const { code, includesRemovedLines } = renderHeadBlock(
            group,
            headLines,
            rightSet
        );

        const scopes = [...new Set(group.members.map(m => m.plan.scope))];
        const symbols = [
            ...new Set(group.members.map(m => m.plan.fn?.symbol).filter(Boolean))
        ];

        for (const member of group.members) {
            blockIdByRegion.set(member.region.id, id);
        }

        blocks.push({
            id,
            version: "head",
            scope: scopes.length === 1 ? scopes[0] : "mixed",
            symbols,
            startLine: group.start,
            endLine: group.end,
            regionIds: group.members.map(m => `${path}#${m.region.id}`),
            includesRemovedLines,
            code
        });
    }

    for (const item of prepared.filter(p => p.plan.mode === "diff_only")) {
        const id = `${path}#block${blocks.length + 1}`;
        const numbers =
            item.plan.version === "base"
                ? item.region.removedLines
                : [...item.region.addedLines, ...item.region.removedLines];

        blockIdByRegion.set(item.region.id, id);

        blocks.push({
            id,
            version: item.plan.version,
            scope: item.plan.scope,
            symbols: [],
            startLine: numbers.length ? Math.min(...numbers) : null,
            endLine: numbers.length ? Math.max(...numbers) : null,
            regionIds: [`${path}#${item.region.id}`],
            includesRemovedLines: item.region.removed.length > 0,
            code: renderDiffOnly(item.region)
        });
    }

    const functions = new Map();

    for (const { plan } of prepared) {
        if (!plan.fn) continue;

        const id = ["head", plan.fn.symbol, plan.fn.startLine, plan.fn.endLine].join(":");

        if (!functions.has(id)) {
            functions.set(id, {
                id,
                version: "head",
                name: plan.fn.symbol,
                kind: plan.fn.kind,
                startLine: plan.fn.startLine,
                endLine: plan.fn.endLine,
                signature: headLines[plan.fn.startLine - 1]?.trim() ?? ""
            });
        }
    }

    const outRegions = prepared.map(({ region, plan }) => {
        const addOnly = region.isPureAddition;
        const delOnly = region.isPureDeletion;
        const fnId = plan.fn
            ? ["head", plan.fn.symbol, plan.fn.startLine, plan.fn.endLine].join(":")
            : null;

        return {
            id: `${path}#${region.id}`,
            hunkIndex: region.hunkIndex,
            type: addOnly ? "addition" : delOnly ? "deletion" : "modification",

            // New-file (RIGHT) numbers. null for a pure deletion.
            startLine: delOnly ? null : region.startLine,
            endLine: delOnly ? null : region.endLine,
            newRange: delOnly ? null : region.newRange,
            removedBeforeNewLine: delOnly ? region.newRange.startLine : null,

            // Old-file (LEFT) numbers. null for a pure addition.
            oldStartLine: addOnly ? null : region.oldStartLine,
            oldEndLine: addOnly ? null : region.oldEndLine,
            oldRange: addOnly ? null : region.oldRange,
            insertedBeforeOldLine:
                addOnly && file.status !== "added" ? region.oldStartLine : null,

            isPureAddition: addOnly,
            isPureDeletion: delOnly,

            added: region.added,
            removed: region.removed,
            addedLines: region.addedLines,
            removedLines: region.removedLines,

            // Debug only. Strip these before building the LLM prompt.
            contextBefore: region.contextBefore,
            contextAfter: region.contextAfter,

            version: plan.version,
            scope: plan.scope,
            contextStatus: plan.scope,
            functionId: fnId,
            blockId: blockIdByRegion.get(region.id) ?? null,

            ...(plan.deletedSymbols?.length
                ? { deletedSymbols: plan.deletedSymbols }
                : {}),
            ...(plan.warning ? { contextWarning: plan.warning } : {})
        };
    });

    return {
        path,
        previousPath: file.basePath && file.basePath !== path ? file.basePath : null,
        language: detectLanguage(path),
        status: file.status,
        parsedOk: headStructure ? headStructure.ok : null,
        parseWarnings: headStructure?.parseErrors ?? [],
        ignoredWhitespaceRegions: trivialRegions.length,
        trivialRegions,
        commentableLines: parsed.commentableLines,
        functions: [...functions.values()],
        blocks,
        regions: outRegions,
        hunks: parsed.hunks.map(hunk => ({
            index: hunk.index,
            oldStartLine: hunk.oldStartLine,
            oldLineCount: hunk.oldLineCount,
            newStartLine: hunk.newStartLine,
            newLineCount: hunk.newLineCount,
            regionIds: hunk.regions.map(r => `${path}#${r.id}`)
        }))
    };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function isCommentable(fileContext, side, line) {
    const list =
        side === "LEFT"
            ? fileContext.commentableLines.left
            : fileContext.commentableLines.right;

    return list.includes(line);
}

export function buildReviewContext(collected) {
    const files = [];
    const skipped = [...(collected.skipped ?? [])];

    for (const file of collected.files ?? []) {
        try {
            const fileContext = buildFileContext(file);

            if (fileContext.regions.length === 0) {
                skipped.push({
                    path: file.path,
                    reason: !file.patch
                        ? "no patch available (binary, too large, or no content change)"
                        : "no reviewable changes (only whitespace, formatting or comment edits)"
                });
            } else {
                files.push(fileContext);
            }
        } catch (error) {
            skipped.push({
                path: file.path,
                reason: `context build failed: ${error.message}`
            });
        }
    }

    return {
        pr: collected.pr,
        codeFormat: CODE_FORMAT_LEGEND,
        files,
        skipped
    };
}