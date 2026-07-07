import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const STORAGE_KEY = "outsourcing_team_schedule_data";

export async function GET() {
  try {
    // Vercel KV uses Upstash Redis underneath
    const data: any = await kv.get(STORAGE_KEY);
    if (!data) {
      return NextResponse.json({ tasks: [] });
    }
    return NextResponse.json(typeof data === "string" ? JSON.parse(data) : data);
  } catch (error) {
    console.error("Vercel KV GET error:", error);
    return NextResponse.json({ tasks: [], error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    await kv.set(STORAGE_KEY, body);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Vercel KV POST error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
