import { OpenRouter } from "@openrouter/sdk";
import dotenv from "dotenv";

dotenv.config();

const openrouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

export async function askLLM(messages) {
  const response = await openrouter.chat.send({
    chatRequest: {
      model: MODEL,
      messages,
      stream: false,
    },
  });

  const message = response.choices?.[0]?.message;

  return {
    content: message?.content ?? "",
    usage: response.usage,
  };
}