import { askLLM } from "./llm.js";

export async function generateReview({
    fileContent,
    findings,
    diff
}) {
    const prompt = `
You are an expert code reviewer.

Review the following file using the static analysis findings and PR diff.

FILE:
${fileContent}

STATIC ANALYSIS FINDINGS:
${JSON.stringify(findings, null, 2)}

PR DIFF:
${diff}

Analyze all findings together and determine which ones are actually real issues in the context of the code and PR.

Return ONLY valid JSON in exactly this format:

{
  "issues": [
    {
      "isIssue": true,
      "severity": "high",
      "confidence": 0.95,
      "explanation": "Explain why this is or is not a real issue.",
      "suggestedFix": "Explain how to fix it."
    }
  ]
}

Rules:
- Return one item in "issues" for each static analysis finding.
- Keep the same order as the input findings.
- isIssue must be true or false.
- severity must be one of: "low", "medium", "high", "critical".
- confidence must be a number between 0 and 1.
- explanation must be a string.
- suggestedFix must be a string.
- Do not include markdown.
- Do not include code fences.
- Return only the JSON object.
`;

    const response = await askLLM([
        {
            role: "user",
            content: prompt
        }
    ]);

    // console.log("RAW AI RESPONSE:");
    // console.log(response.content);

    const review = JSON.parse(response.content);

    return {
        review,
        usage: response.usage
    };
}