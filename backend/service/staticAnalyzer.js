import { ESLint } from "eslint";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

import { normalizeFindings, keepChangedLines } from "./findingNormalizer.js";

import { detectLanguage } from "./languageDetector.js";
import { selectAnalyzer } from "./analyzerSelector.js";

const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
        files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],

        languageOptions: {
            parser: tsParser,
            sourceType: "module",
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: { ...globals.browser, ...globals.node }
        },

        plugins: {
            "@typescript-eslint": tsPlugin,
            "react-hooks": reactHooks
        },

        rules: {
            // TypeScript already checks these, and they misfire on type names.
            "no-undef": "off",
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    args: "after-used",
                    ignoreRestSiblings: true,
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_"
                }
            ],

            // Likely-bug rules that work without type information.
            "no-dupe-keys": "error",
            "no-dupe-else-if": "error",
            "no-duplicate-case": "error",
            "no-unreachable": "error",
            "no-self-assign": "error",
            "no-self-compare": "warn",
            "no-const-assign": "error",
            "no-cond-assign": "error",
            "no-constant-condition": ["warn", { checkLoops: false }],
            "no-unsafe-optional-chaining": "error",
            "no-unsafe-finally": "error",
            "no-fallthrough": "warn",
            "no-sparse-arrays": "warn",
            "use-isnan": "error",
            "valid-typeof": "error",

            // The most common React bugs.
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn"
        }
    }
});

/**
 * Lint one file's head content. Never throws.
 * @param {{ path: string, content: string | null }} file
 */
export async function runStaticAnalyzer(file) {
    if (typeof file.content !== "string") {
        return { skipped: true, reason: "no head content", messages: [] };
    }

        if (selectAnalyzer(detectLanguage(file.path)) !== "eslint") {
        return { skipped: true, reason: "no analyzer for this file type", messages: [] };
    }

    try {
        const [result] = await eslint.lintText(file.content, {
            filePath: file.path
        });

        return { skipped: false, messages: result?.messages ?? [] };
    } catch (error) {
        return {
            skipped: true,
            reason: `eslint failed: ${error.message}`,
            messages: []
        };
    }
}

/**
 * Run ESLint on every file in the review context and keep only
 * findings that sit on lines the PR added.
 *
 * @param {object[]} collectedFiles  collector output (has .path and .content)
 * @param {object}   reviewContext   output of buildReviewContext
 * @returns {Promise<Record<string, object>>} results keyed by file path
 */
export async function analyzeChangedFiles(collectedFiles, reviewContext) {
    const contentByPath = new Map(collectedFiles.map(f => [f.path, f.content]));
    const output = {};

    for (const fileContext of reviewContext.files) {
        const run = await runStaticAnalyzer({
            path: fileContext.path,
            content: contentByPath.get(fileContext.path) ?? null
        });

        const { findings, parseErrors } = normalizeFindings(
            fileContext.path,
            run.messages
        );

        const { kept, dropped } = keepChangedLines(findings, fileContext);

        output[fileContext.path] = {
            skipped: run.skipped,
            reason: run.reason ?? null,
            parseErrors,
            findings: kept,
            droppedPreexisting: dropped
        };
    }

    return output;
}