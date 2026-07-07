import { kv } from "@vercel/kv";

// Check if Vercel KV env variables are configured
export const isKVConfigured = !!(
  process.env.KV_URL &&
  process.env.KV_REST_API_URL &&
  process.env.KV_REST_API_TOKEN
);

// We will export a client-side friendly interface that calls Next.js API Routes 
// to avoid exposing the KV read/write tokens directly on the browser/client-side.
// Next.js API Routes are secure server-side environments.

export async function fetchTasksFromServer(): Promise<any[]> {
  if (!isKVConfigured && process.env.NODE_ENV === "production") {
    console.warn("Vercel KV is not configured. Running in offline/fallback mode.");
    return [];
  }
  
  try {
    const res = await fetch("/api/tasks");
    if (!res.ok) throw new Error("Failed to fetch tasks");
    const data = await res.json();
    return data.tasks || [];
  } catch (error) {
    console.error("Error fetching tasks from Vercel KV:", error);
    return [];
  }
}

export async function saveTasksToServer(tasks: any[]): Promise<boolean> {
  try {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tasks }),
    });
    return res.ok;
  } catch (error) {
    console.error("Error saving tasks to Vercel KV:", error);
    return false;
  }
}
