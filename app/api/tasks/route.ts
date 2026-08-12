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
    
    // Google Apps Script requires text/plain to avoid CORS preflight options issues when redirecting
    const res = await fetch(GAS_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(body),
      redirect: "follow",
      keepalive: true,
    });

    if (!res.ok) {
      throw new Error(`GAS 웹훅 응답 오류 (HTTP ${res.status})`);
    }

    let data: any = {};
    try {
      data = await res.json();
    } catch {
      data = { success: true };
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("GAS POST error:", error);
    const errorString = error?.message || String(error);
    return NextResponse.json({ success: false, error: `구글 시트 동기화 실패: ${errorString}` }, { status: 500 });
  }
}

