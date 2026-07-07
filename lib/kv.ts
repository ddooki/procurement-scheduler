
// Check if Vercel KV environment variables are actually configured in the environment (on server-side)
export const isKVConfigured = !!(
  process.env.KV_URL &&
  process.env.KV_REST_API_URL &&
  process.env.KV_REST_API_TOKEN
);

export async function checkServerKVStatus(): Promise<boolean> {
  try {
    const res = await fetch("/api/tasks/status");
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.configured;
  } catch {
    return false;
  }
}

export async function fetchTasksFromServer(): Promise<any[]> {
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
