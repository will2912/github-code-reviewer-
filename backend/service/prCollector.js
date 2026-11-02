
const GITHUB_API = "https://api.github.com";

const REVIEWABLE_EXTENSIONS = [
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"
];

const IGNORED_FOLDERS = [
    "node_modules/", "dist/", "build/", "coverage/",
    ".next/", "vendor/"
];

const IGNORED_FILE_NAMES = [
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml"
];

const MAX_FILE_BYTES = 200 * 1024;
const CONCURRENCY = 5;

function buildHeaders(accept = "application/vnd.github+json") {
    return {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28"
    };
}

async function githubGet(url, accept) {
    const response = await fetch(url, {
        method: "GET",
        headers: buildHeaders(accept)
    });

    if (!response.ok) {
        const text = await response.text();

        throw new Error(
            `GitHub ${response.status} for ${url}: ${text.slice(0, 200)}`
        );
    }

    return response;
}

async function fetchPRDetails(owner, repo, prId) {
    const response = await githubGet(
        `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prId}`
    );

    const pr = await response.json();

    return {
        title: pr.title,
        description: pr.body || "",
        author: pr.user?.login,
        baseBranch: pr.base.ref,
        headBranch: pr.head.ref,
        baseSha: pr.base.sha,
        headSha: pr.head.sha
    };
}

async function fetchChangedFiles(owner, repo, prId) {
    const allFiles = [];

    for (let page = 1; page <= 30; page++) {
        const response = await githubGet(
            `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prId}/files?per_page=100&page=${page}`
        );

        const batch = await response.json();
        allFiles.push(...batch);

        if (batch.length < 100) break;
    }

    return allFiles;
}

function getSkipReason(file) {
    const path = file.filename;
    const baseName = path.split("/").pop();

    if (file.status === "removed") return "file was removed";
    if (!file.patch) return "no diff available (binary or too large)";

    if (!REVIEWABLE_EXTENSIONS.some(ext => path.endsWith(ext))) {
        return "unsupported file type";
    }

    if (IGNORED_FILE_NAMES.includes(baseName)) return "lockfile";
    if (baseName.endsWith(".min.js")) return "minified file";
    if (path.endsWith(".d.ts")) return "type declaration file";

    if (
        IGNORED_FOLDERS.some(folder =>
            ("/" + path).includes("/" + folder)
        )
    ) {
        return "generated or vendor folder";
    }

    return null;
}

function patchHasDeletions(patch = "") {
    let insideHunk = false;

    for (const line of patch.split("\n")) {
        if (line.startsWith("@@")) {
            insideHunk = true;
            continue;
        }

        if (insideHunk && line.startsWith("-")) {
            return true;
        }
    }

    return false;
}

export async function fetchFileContent(owner, repo, path, ref, cache) {
    const key = `${path}@${ref}`;

    if (cache.has(key)) {
        return cache.get(key);
    }

    const encodedPath = path
        .split("/")
        .map(encodeURIComponent)
        .join("/");

    const response = await githubGet(
        `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${ref}`,
        "application/vnd.github.raw+json"
    );

    const content = await response.text();
    cache.set(key, content);

    return content;
}

async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const index = nextIndex++;

            if (index >= items.length) return;

            results[index] = await fn(items[index]);
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(limit, items.length) },
            () => worker()
        )
    );

    return results;
}

export async function collectPR({ owner, repo, prId }) {
    const pr = await fetchPRDetails(owner, repo, prId);
    const changedFiles = await fetchChangedFiles(owner, repo, prId);

    const skipped = [];
    const candidates = [];

    for (const file of changedFiles) {
        const reason = getSkipReason(file);

        if (reason) {
            skipped.push({
                path: file.filename,
                reason
            });
        } else {
            candidates.push(file);
        }
    }

    const fileCache = new Map();

    const fetched = await mapWithConcurrency(
        candidates,
        CONCURRENCY,
        async file => {
            try {
                const content = await fetchFileContent(
                    owner,
                    repo,
                    file.filename,
                    pr.headSha,
                    fileCache
                );

                if (
                    Buffer.byteLength(content, "utf-8") >
                    MAX_FILE_BYTES
                ) {
                    return {
                        skip: {
                            path: file.filename,
                            reason: "head file too large"
                        }
                    };
                }

                let baseContent;
                let baseContentError;
                let basePath = file.previous_filename ?? file.filename;

                if (
                    file.status !== "added" &&
                    patchHasDeletions(file.patch)
                ) {
                    try {
                        baseContent = await fetchFileContent(
                            owner,
                            repo,
                            basePath,
                            pr.baseSha,
                            fileCache
                        );

                        if (
                            Buffer.byteLength(baseContent, "utf-8") >
                            MAX_FILE_BYTES
                        ) {
                            baseContent = undefined;
                            baseContentError = "base file too large";
                        }
                    } catch (error) {
                        baseContentError = error.message;
                    }
                }

                return {
                    file: {
                        path: file.filename,
                        status: file.status,
                        patch: file.patch,
                        content,
                        baseContent,
                        baseContentError,
                        basePath
                    }
                };
            } catch (error) {
                return {
                    skip: {
                        path: file.filename,
                        reason: `could not fetch content: ${error.message}`
                    }
                };
            }
        }
    );

    const files = [];

    for (const item of fetched) {
        if (item.file) {
            files.push(item.file);
        } else {
            skipped.push(item.skip);
        }
    }

    return {
        owner,
        repo,
        prId,
        pr,
        files,
        skipped,
        fileCache
    };
}
