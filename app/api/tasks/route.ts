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
    return NextResponse.json({ success: false, error: "Database not configured" }, { status: 500 });
  }

  try {
    const body = await request.json();
    
    const res = await fetch(GAS_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`GAS returned status ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("GAS POST error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

