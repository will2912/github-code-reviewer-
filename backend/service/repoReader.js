import { posix } from "node:path";

const GITHUB_API = "https://api.github.com";

function headers(accept) {
    return {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28"
    };
}

const encodePath = path => path.split("/").map(encodeURIComponent).join("/");

// tsconfig.json allows comments and trailing commas.
function parseJsonc(text) {
    let out = "";
    let inString = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];

        if (inString) {
            out += ch;
            if (ch === "\\") { out += next ?? ""; i++; }
            else if (ch === '"') inString = false;
            continue;
        }

        if (ch === '"') { inString = true; out += ch; continue; }

        if (ch === "/" && next === "/") {
            while (i < text.length && text[i] !== "\n") i++;
            out += "\n";
            continue;
        }

        if (ch === "/" && next === "*") {
            i += 2;
            while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
            i++;
            continue;
        }

        out += ch;
    }

    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

function joinBase(baseUrl, target) {
    const joined = posix.normalize(`${baseUrl || "."}/${target || "."}`);
    return joined === "." ? "" : joined.replace(/\/?$/, "/");
}

/**
 * Reads other files of the repository at one commit.
 * Files already fetched by the PR collector are served from memory.
 * Every real GitHub request counts against maxFetches.
 */
export function createRepoReader({ owner, repo, ref, seedFiles = [], maxFetches = 8 }) {
    const cache = new Map();
    let fetchCount = 0;
    let treePromise = null;
    let aliasPromise = null;

    for (const file of seedFiles) {
        if (typeof file.content === "string") cache.set(file.path, file.content);
    }

    function getTree() {
        if (!treePromise) {
            treePromise = (async () => {
                fetchCount++;

                try {
                    const response = await fetch(
                        `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`,
                        { headers: headers("application/vnd.github+json") }
                    );

                    if (!response.ok) {
                        return { ok: false, paths: [], error: `tree request failed (${response.status})` };
                    }

                    const data = await response.json();

                    return {
                        ok: true,
                        truncated: Boolean(data.truncated),
                        paths: (data.tree ?? [])
                            .filter(item => item.type === "blob")
                            .map(item => item.path)
                    };
                } catch (error) {
                    return { ok: false, paths: [], error: error.message };
                }
            })();
        }

        return treePromise;
    }

    async function readFile(path) {
        if (cache.has(path)) {
            return { ok: true, content: cache.get(path), cached: true };
        }

        if (fetchCount >= maxFetches) {
            return { ok: false, reason: "fetch budget used up" };
        }

        fetchCount++;

        try {
            const response = await fetch(
                `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
                { headers: headers("application/vnd.github.raw+json") }
            );

            if (!response.ok) {
                return { ok: false, reason: `GitHub returned ${response.status}` };
            }

            const content = await response.text();
            cache.set(path, content);

            return { ok: true, content, cached: false };
        } catch (error) {
            return { ok: false, reason: error.message };
        }
    }

    function getAliases() {
        if (!aliasPromise) {
            aliasPromise = (async () => {
                const result = await readFile("tsconfig.json");

                if (result.ok) {
                    try {
                        const config = parseJsonc(result.content);
                        const baseUrl = (config.compilerOptions?.baseUrl ?? ".")
                            .replace(/^\.\//, "")
                            .replace(/^\.$/, "");
                        const paths = config.compilerOptions?.paths ?? {};

                        const aliases = Object.entries(paths)
                            .filter(([key]) => key.endsWith("*"))
                            .map(([key, targets]) => ({
                                prefix: key.replace(/\*$/, ""),
                                targets: targets.map(target =>
                                    joinBase(baseUrl, target.replace(/^\.\//, "").replace(/\*$/, ""))
                                )
                            }));

                        if (aliases.length > 0) return aliases;
                    } catch {
                        // fall through to the default
                    }
                }

                return [{ prefix: "@/", targets: ["src/", ""] }];
            })();
        }

        return aliasPromise;
    }

    return {
        getTree,
        getAliases,
        readFile,
        fetchCount: () => fetchCount
    };
}