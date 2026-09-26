export function selectAnalyzer(language) {
  const analyzers = {
    javascript: "eslint",
    typescript: "eslint",
  };

  return analyzers[language] || null;
}