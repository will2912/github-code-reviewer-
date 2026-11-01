import { askLLM } from "./llm.js";

/**
 * Thin adapter over the existing askLLM.
 *
 * @param {{ role: string, content: string }[]} messages
 * @returns {Promise<{ content: string, usage: object | undefined }>}
 */
export async function callLLM(messages) {
    const response = await askLLM(messages);

    return {
        content: response?.content ?? "",
        usage: response?.usage
    };
}