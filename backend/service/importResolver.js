import { posix } from "node:path";
import { getStructureRanges } from "./astAnalyzer.js";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const READABLE = /\.(js|jsx|ts|tsx|mjs|cjs|json|css|scss|md|html|ya?ml|sql|prisma|graphql)$/i;
const SENSITIVE = /(^|\/)\.env(\.|$)|\.(pem|key|p12|pfx)$|id_rsa|id_ed25519|secret|credential/i;
const IGNORED_DIRS = /(^|\/)(node_modules|\.next|dist|build|coverage|\.git)\//;
const IMPORT_RE = /import\s+(?:type\s+)?([\w$\s{},*]+?)\s+from\s+["']([^"']+)["']/g;

const MAX_FILE_LINES = 250;
const MAX_FILE_CHARS = 9000;

/* ---------------------------------------------------------------- */
/* Path index                                                        */
/* ---------------------------------------------------------------- */

export function buildPathIndex(allPaths) {
    const paths = allPaths.filter(p => !IGNORED_DIRS.test(p));
    const exact = new Set(paths);
    const lower = new Map();

    for (const p of paths) {
        const key = p.toLowerCase();
        if (!lower.has(key)) lower.set(key, p);
    }

    return { paths, exact, lower };
}

function lookup(index, candidate) {
    if (index.exact.has(candidate)) return candidate;
    return index.lower.get(candidate.toLowerCase()) ?? null;
}

function tryCandidates(index, base) {
    if (!base) return null;

    const clean = posix.normalize(base).replace(/^\.\//, "");
    if (!clean || clean === "." || clean.startsWith("..")) return null;

    const options = [
        clean,
        ...EXTENSIONS.map(ext => clean + ext),
        ...EXTENSIONS.map(ext => `${clean}/index${ext}`)
    ];

    for (const option of options) {
        const hit = lookup(index, option);
        if (hit) return hit;
    }

    return null;
}

function resolveSpecifier(specifier, fromPath, aliases, index) {
    if (specifier.startsWith(".")) {
        if (!fromPath) return null;
        return tryCandidates(index, posix.join(posix.dirname(fromPath), specifier));
    }

    for (const alias of aliases) {
        if (!specifier.startsWith(alias.prefix)) continue;

        const rest = specifier.slice(alias.prefix.length);

        for (const target of alias.targets) {
            const hit = tryCandidates(index, target + rest);
            if (hit) return hit;
        }
    }

    return null; // an external package
}

function findByBasename(name, index) {
    const wanted = name.toLowerCase();

    const matches = index.paths.filter(
        p =>
            READABLE.test(p) &&
            posix.basename(p).replace(/\.[^.]+$/, "").toLowerCase() === wanted
    );

    if (matches.length === 0) return null;

    matches.sort((a, b) => a.length - b.length);
    return matches[0];
}

/* ---------------------------------------------------------------- */
/* Imports                                                           */
/* ---------------------------------------------------------------- */

export function parseImports(source) {
    const imports = [];

    for (const match of source.matchAll(IMPORT_RE)) {
        const clause = match[1].trim();
        const names = [];
        const braces = clause.match(/\{([^}]*)\}/);
        const outside = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();

        if (outside) {
            const namespace = outside.match(/^\*\s+as\s+([\w$]+)$/);

            if (namespace) names.push({ local: namespace[1], imported: "*" });
            else names.push({ local: outside.split(/\s+/)[0], imported: "default" });
        }

        if (braces) {
            for (const part of braces[1].split(",")) {
                const item = part.trim().replace(/^type\s+/, "");
                if (!item) continue;

                const [imported, local] = item.split(/\s+as\s+/).map(s => s.trim());
                names.push({ local: local || imported, imported });
            }
        }

        imports.push({ specifier: match[2], names });
    }

    return imports;
}

function findBinding(name, sources, preferFrom) {
    const order = [];

    if (preferFrom && sources.has(preferFrom)) order.push(preferFrom);
    for (const path of sources.keys()) if (path !== preferFrom) order.push(path);

    for (const fromPath of order) {
        for (const entry of parseImports(sources.get(fromPath))) {
            const hit = entry.names.find(n => n.local === name || n.imported === name);

            if (hit) {
                return { fromPath, specifier: entry.specifier, imported: hit.imported };
            }
        }
    }

    return null;
}

/* ---------------------------------------------------------------- */
/* Resolve one request to a repository path                          */
/* ---------------------------------------------------------------- */

function resolveFilePath(request, aliases, index) {
    const raw = String(request.path).replace(/^["'`]|["'`]$/g, "").trim();

    return (
        tryCandidates(index, raw) ??
        resolveSpecifier(raw, request.from, aliases, index) ??
        tryCandidates(index, raw.replace(/^\.?\//, "")) ??
        findByBasename(posix.basename(raw).replace(/\.[^.]+$/, ""), index)
    );
}

/**
 * @returns {{ ok: true, path: string, symbol: string | null } | { ok: false, reason: string }}
 */
export function resolveRequest(request, { index, aliases, sources }) {
    if (!index || index.paths.length === 0) {
        return { ok: false, reason: "repository file list unavailable" };
    }

    let target = null;
    let symbol = null;

    if (request.type === "symbol") {
        const binding = findBinding(request.name, sources, request.from);

        if (binding) {
            target = resolveSpecifier(binding.specifier, binding.fromPath, aliases, index);
        }

        if (!target) target = findByBasename(request.name, index);

        symbol =
            binding && binding.imported !== "default" && binding.imported !== "*"
                ? binding.imported
                : request.name;
    } else {
        target = resolveFilePath(request, aliases, index);
    }

    if (!target) {
        return {
            ok: false,
            reason: "not found in the repository (external package or unknown path)"
        };
    }

    if (SENSITIVE.test(target)) {
        return { ok: false, reason: "blocked: sensitive file" };
    }

    if (!READABLE.test(target)) {
        return { ok: false, reason: "not a readable source file" };
    }

    return { ok: true, path: target, symbol };
}

/* ---------------------------------------------------------------- */
/* Turn a fetched file into prompt evidence                          */
/* ---------------------------------------------------------------- */

function renderRows(lines, ranges) {
    const width = String(Math.max(...ranges.map(r => r.endLine))).length;
    const out = [];
    let chars = 0;
    let truncated = false;

    ranges.forEach((range, i) => {
        if (truncated) return;
        if (i > 0) out.push(`${" ".repeat(width)} | ...`);

        for (let n = range.startLine; n <= range.endLine; n++) {
            const row = `${String(n).padStart(width)} | ${lines[n - 1] ?? ""}`;

            if (chars + row.length > MAX_FILE_CHARS) {
                truncated = true;
                break;
            }

            out.push(row);
            chars += row.length + 1;
        }
    });

    if (truncated) out.push(`${" ".repeat(width)} | ... (truncated)`);

    return { code: out.join("\n"), truncated };
}

export function extractEvidence({ path, content, symbol }) {
    const lines = content.split(/\r?\n/);
    let ranges = null;
    let note = "";

    if (symbol) {
        const structure = getStructureRanges(content, path);

        if (structure.ok) {
            const found = structure.ranges.filter(
                r =>
                    r.named &&
                    (r.name === symbol || r.name.endsWith(`.${symbol}`)) &&
                    ["function", "method", "class", "declaration"].includes(r.kind)
            );

            const outer = found.filter(
                r =>
                    !found.some(
                        o =>
                            o !== r &&
                            o.startLine <= r.startLine &&
                            o.endLine >= r.endLine &&
                            (o.startLine < r.startLine || o.endLine > r.endLine)
                    )
            );

            if (outer.length > 0) {
                ranges = outer
                    .slice(0, 2)
                    .map(r => ({ startLine: r.startLine, endLine: r.endLine }));
            }
        }

        if (!ranges) note = `symbol "${symbol}" not located; showing the start of the file`;
    }

    if (!ranges) {
        const end = Math.min(lines.length, MAX_FILE_LINES);
        ranges = [{ startLine: 1, endLine: Math.max(1, end) }];

        if (lines.length > end) {
            note = [note, `${lines.length - end} more lines not shown`].filter(Boolean).join("; ");
        }
    }

    const { code, truncated } = renderRows(lines, ranges);

    if (truncated) note = [note, "cut at the size limit"].filter(Boolean).join("; ");

    return { path, symbol: symbol ?? null, ranges, code, note, totalLines: lines.length };
}