import { OpenRouter } from "@openrouter/sdk";
import dotenv from "dotenv";

dotenv.config();

console.log(
  "Key loaded:",
  process.env.OPENROUTER_API_KEY ? "yes" : "NO - missing!"
);

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

try {
  const response = await openrouter.chat.send({
    chatRequest: {
      model: "nvidia/nemotron-3-super-120b-a12b:free",

      messages: [
        {
          role: "user",
          content: "tell me the president of india",
        },
      ],

      stream: false,
    },
  });

  const usage = response.usage;

  const contextLimit = 262_000;
  const promptTokens = usage?.promptTokens ?? 0;

  const keyResponse = await fetch("https://openrouter.ai/api/v1/key", {
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
  });

  const keyData = await keyResponse.json();
  const daily = keyData.data.free_model_daily_requests;

  console.log(`
========== RESPONSE ==========
${response.choices?.[0]?.message?.content}

========== USAGE ==========
Prompt: ${usage?.promptTokens}
Completion: ${usage?.completionTokens}
Reasoning: ${usage?.completionTokensDetails?.reasoningTokens}
Total: ${usage?.totalTokens}
Cost: ${usage?.cost}

========== CONTEXT WINDOW ==========
Used: ${promptTokens}
Remaining: ${contextLimit - promptTokens}
Capacity: ${contextLimit}

========== DAILY FREE LIMIT ==========
Used: ${daily.used} | Remaining: ${daily.remaining} | Limit: ${daily.limit}
`);
} catch (err) {
  console.error("\n========== ERROR ==========");
  console.error(err);
}