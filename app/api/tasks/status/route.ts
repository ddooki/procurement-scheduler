import { NextResponse } from "next/server";

export async function GET() {
  const configured = !!process.env.GAS_WEBHOOK_URL;
  return NextResponse.json({ configured });
}

