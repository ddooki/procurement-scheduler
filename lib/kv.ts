
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

export async function saveTasksToServer(tasks: any[], notes: any[] = []): Promise<{ success: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout safeguard

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tasks, notes }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      let errorMsg = `서버 응답 오류 (HTTP ${res.status})`;
      try {
        const data = await res.json();
        if (data.error) errorMsg = data.error;
      } catch {}
      return { success: false, error: errorMsg };
    }

    const data = await res.json().catch(() => ({}));
    if (data.error) {
      return { success: false, error: data.error };
    }
    return { success: true };
  } catch (error: any) {
    console.error("Error saving data to Google Spreadsheet (GAS):", error);
    const isTimeout = error?.name === "AbortError";
    return {
      success: false,
      error: isTimeout
        ? "구글 시트 응답 시간(15초) 초과. 백그라운드 서버 처리가 지연되고 있습니다."
        : (error?.message ? `네트워크/통신 예외: ${error.message}` : "서버 네트워크 연결 실패"),
    };
  }
}

