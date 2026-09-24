import { OpenRouter } from "@openrouter/sdk";
import dotenv from "dotenv";
dotenv.config();
import redis from "../lib/redis.js"
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";


console.log(
  "Key loaded:",
  process.env.OPENROUTER_API_KEY ? "yes" : "NO - missing!"
);
const rl = readline.createInterface({ input, output });
const mode = await rl.question(
  "1. Continue conversation\n2. New conversation\nChoose: "
);

if (mode === "2") {
  await redis.del("current_conversation");
  console.log("Started a new conversation.\n");
} else if (mode !== "1") {
  console.log("Invalid choice.");
  await redis.quit();
  rl.close();
  process.exit(0);
}
try {
while(true){


const question = await rl.question("You: ")
if(question.toLowerCase()==="exit"){
  console.log("goodbye ")
  break;
}
const storedMessages = await redis.get("current_conversation");
const messages = storedMessages
  ? JSON.parse(storedMessages)
  : [];

messages.push({
  role: "user",
  content: question,
});

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});


  const response = await openrouter.chat.send({
    chatRequest: {
      model: "nvidia/nemotron-3-super-120b-a12b:free",
      messages,
      stream: false,
    },
  });

const assistantMessage = response.choices?.[0]?.message?.content;
console.log(`AI: ${assistantMessage}`);

messages.push({
  role: "assistant",
  content: assistantMessage,
});

await redis.set(
  "current_conversation",
  JSON.stringify(messages)
);



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
  }
} catch (err) {
  console.error("\n========== ERROR ==========");
  console.error(err);
}finally {
  await redis.quit();
  rl.close();
}
