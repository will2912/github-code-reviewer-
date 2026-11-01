const LANGUAGE_BY_EXTENSION = {
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescript"
};

export function detectLanguage(filename = "") {
    const dot = filename.lastIndexOf(".");
    if (dot === -1) return "unknown";

    const extension = filename.slice(dot + 1).toLowerCase();
    return LANGUAGE_BY_EXTENSION[extension] ?? "unknown";
}