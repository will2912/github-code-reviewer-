import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import dotenv from "dotenv";
dotenv.config();

import {
  getConversation,
  saveConversation,
  clearConversation,
} from "../service/conversation.js";

import { askLLM } from "../service/llm.js";

import redis from "../lib/redis.js"

const rl = readline.createInterface({
  input,
  output,
});

const CONTEXT_LIMIT = 262_000;

try {
  const mode = await rl.question(
    "1. Continue conversation\n2. New conversation\nChoose: "
  );

  if (mode === "2") {
    await clearConversation();
    console.log("\nStarted a new conversation.\n");
  } else if (mode !== "1") {
    console.log("Invalid choice.");
    process.exit(0);
  }

  while (true) {
    const question = await rl.question("You: ");

    if (question.toLowerCase() === "exit") {
      console.log("goodbye");
      break;
    }

    const messages = await getConversation();

    messages.push({
      role: "user",
      content: question,
    });

    const response = await askLLM(messages);

    console.log(`AI: ${response.content}`);

    messages.push({
      role: "assistant",
      content: response.content,
    });

    await saveConversation(messages);

    const usage = response.usage;
      const keyResponse = await fetch("https://openrouter.ai/api/v1/key", {
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
  });

  const keyData = await keyResponse.json();
  const daily = keyData.data.free_model_daily_requests;

    const promptTokens = usage?.promptTokens ?? 0;
    const completionTokens = usage?.completionTokens ?? 0;
    const reasoningTokens =
      usage?.completionTokensDetails?.reasoningTokens ?? 0;
    const totalTokens = usage?.totalTokens ?? 0;
    const cost = usage?.cost ?? 0;

    console.log("\n========== USAGE ==========");
    console.log(`Prompt: ${promptTokens}`);
    console.log(`Completion: ${completionTokens}`);
    console.log(`Reasoning: ${reasoningTokens}`);
    console.log(`Total: ${totalTokens}`);
    console.log(`Cost: ${cost}`);

    console.log("\n========== CONTEXT ==========");
    console.log(`Used: ${promptTokens}`);
    console.log(
      `Remaining: ${CONTEXT_LIMIT - promptTokens}`
    );
    console.log(`Capacity: ${CONTEXT_LIMIT}`);
    console.log("\n========== DAILY FREE LIMIT ==========");
console.log(
  `Used: ${daily.used} | Remaining: ${daily.remaining} | Limit: ${daily.limit}`
);
console.log();
  }
} catch (err) {
  console.error("\n========== ERROR ==========");
  console.error(err);
} finally {
  rl.close();
  await redis.quit();
}