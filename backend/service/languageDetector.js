export function detectLanguage(filename) {
  const extension = filename.split(".").pop().toLowerCase();

  const languageMap = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
  };

  return languageMap[extension] || "unknown";
}