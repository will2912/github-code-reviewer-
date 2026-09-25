import redis from "../lib/redis.js";

const conversation_key= "current conversation";

export async function getConversation(){
    const storedMessages = await redis.get(conversation_key)
    if(!storedMessages){
        return [];
    }
    return JSON.parse(storedMessages)
}

export async function saveConversation(messages){
    await redis.set(conversation_key,JSON.stringify(messages))
}

export async function clearConversation() {
  await redis.del(conversation_key);
}