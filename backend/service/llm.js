// import { OpenRouter } from "@openrouter/sdk";
// import dotenv from "dotenv";

// dotenv.config();

// console.log(
//   "Key loaded:",
//   process.env.OPENROUTER_API_KEY ? "yes" : "NO - missing!"
// );

// const openrouter = new OpenRouter({
//   apiKey: process.env.OPENROUTER_API_KEY,
// });

// try {
//   const response = await openrouter.chat.send({
//     chatRequest: {
//       model: "nvidia/nemotron-3-super-120b-a12b:free",

//       messages: [
//         {
//           role: "user",
//           content: "tell me what was my last request if you remember",
//         },
//       ],

//       stream: false,
//     },
//   });

// //   console.log("\n========== FULL RESPONSE ==========");
// //   console.dir(response, { depth: null });

//   console.log("\n========== GENERATED TEXT ==========");
//   console.log(response.choices?.[0]?.message?.content);

//   console.log("\n========== FINISH REASON ==========");
//   console.log(response.choices?.[0]?.finishReason);

//   console.log("\n========== USAGE ==========");
//   console.dir(response.usage, { depth: null });

// } catch (err) {
//   console.error("\n========== ERROR ==========");
//   console.error(err);
// }


import dotenv from "dotenv";

dotenv.config();

console.log(
  "Key loaded:",
  process.env.OPENROUTER_API_KEY ? "yes" : "NO - missing!"
);

try {
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
  });

  console.log("\n========== HTTP STATUS ==========");
  console.log(response.status);

  const data = await response.json();

  console.log("\n========== FULL KEY RESPONSE ==========");
  console.dir(data, { depth: null });

} catch (err) {
  console.error("\n========== ERROR ==========");
  console.error(err);
}