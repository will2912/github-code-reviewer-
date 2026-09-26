import { ESLint } from "eslint";
import globals from "globals";

const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
        files: ["**/*.{js,jsx,ts,tsx}"],

        languageOptions: {
            parser: await import("@typescript-eslint/parser").then(
                (module) => module.default
            ),

            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },

        rules: {
            "no-unused-vars": "warn",
            "no-undef": "error",
        },
    },
});

export async function runStaticAnalyzer(file) {
    const results = await eslint.lintText(file.content, {
        filePath: file.filename,
    });

    return results[0];
}