
// Check if Google Apps Script environment variables are actually configured in the environment (on server-side)
export const isKVConfigured = !!process.env.GAS_WEBHOOK_URL;

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

export async function fetchTasksFromServer(): Promise<{ tasks: any[]; notes: any[] }> {
  try {
    const res = await fetch("/api/tasks");
    if (!res.ok) throw new Error("Failed to fetch data");
    const data = await res.json();
    return {
      tasks: data.tasks || [],
      notes: data.notes || [],
    };
  } catch (error) {
    console.error("Error fetching data from Google Spreadsheet (GAS):", error);
    return { tasks: [], notes: [] };
  }
}

export async function saveTasksToServer(tasks: any[], notes: any[] = []): Promise<boolean> {
  try {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tasks, notes }),
    });
    return res.ok;
  } catch (error) {
    console.error("Error saving data to Google Spreadsheet (GAS):", error);
    return false;
  }
}

