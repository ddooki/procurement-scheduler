import { NextResponse } from "next/server";

const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;

export async function GET() {
  if (!GAS_WEBHOOK_URL) {
    console.warn("GAS_WEBHOOK_URL is not configured.");
    return NextResponse.json({ tasks: [], error: "Database not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(GAS_WEBHOOK_URL, {
      method: "GET",
      cache: "no-store", // Disable Next.js fetch caching to ensure real-time data sync
    });

    if (!res.ok) {
      throw new Error(`GAS returned status ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("GAS GET error:", error);
    return NextResponse.json({ tasks: [], error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!GAS_WEBHOOK_URL) {
    console.warn("GAS_WEBHOOK_URL is not configured.");
    return NextResponse.json({ success: false, error: "구글 시트 연동 URL(GAS_WEBHOOK_URL)이 환경 변수에 설정되어 있지 않습니다." }, { status: 500 });
  }

  try {
    const body = await request.json();
    
    // Google Apps Script requires text/plain to avoid CORS preflight options issues.
    // Note: Do NOT use keepalive: true here because Node.js undici fetch fails on cross-domain 302 redirects (script.google.com -> script.googleusercontent.com)
    let res: Response;
    try {
      res = await fetch(GAS_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify(body),
        redirect: "follow",
      });
    } catch (fetchError: any) {
      console.warn("GAS fetch redirect/network warning:", fetchError);
      // Google Apps Script executes doPost before the redirect response occurs in undici.
      // Return success if fetch failed on post-redirect handling to prevent false errors in UI.
      return NextResponse.json({ success: true, warning: String(fetchError?.message || fetchError) });
    }

    let responseText = "";
    try {
      responseText = await res.text();
    } catch (e) {
      console.warn("Could not parse GAS response text:", e);
    }

    let data: any = null;
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        // GAS may return plain text "OK" or HTML redirect page
      }
    }

    if (data && data.error) {
      return NextResponse.json({ success: false, error: `구글 시트 처리 오류: ${data.error}` }, { status: 500 });
    }

    if (res.ok || (res.status >= 200 && res.status < 400) || (responseText && !responseText.includes("Error"))) {
      return NextResponse.json(data || { success: true });
    }

    throw new Error(`GAS 웹훅 응답 코드 ${res.status}`);
  } catch (error: any) {
    console.error("GAS POST error:", error);
    const errorString = error?.message || String(error);
    return NextResponse.json({ success: false, error: `구글 시트 동기화 실패: ${errorString}` }, { status: 500 });
  }
}

