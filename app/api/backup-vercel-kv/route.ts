import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const STORAGE_KEY = "outsourcing_team_schedule_data";

export async function GET() {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return NextResponse.json(
      {
        success: false,
        error: "Vercel KV 환경 변수(KV_REST_API_URL, KV_REST_API_TOKEN)가 로컬 또는 서버 환경에 구성되어 있지 않습니다. Vercel 배포 주소로 배포 후 접속하시거나, 로컬 .env 파일에 환경 변수를 채워넣어주세요.",
      },
      { status: 400 }
    );
  }

  try {
    const data: any = await kv.get(STORAGE_KEY);
    if (!data) {
      return NextResponse.json({ success: true, message: "Vercel KV에 저장된 데이터가 비어 있습니다.", tasks: [] });
    }
    
    const parsedData = typeof data === "string" ? JSON.parse(data) : data;
    return NextResponse.json({
      success: true,
      source: "Vercel KV",
      tasks: parsedData.tasks || parsedData,
    });
  } catch (error) {
    console.error("Vercel KV GET error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
