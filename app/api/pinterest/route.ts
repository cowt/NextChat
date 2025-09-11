import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/api/auth";
import { ModelProvider } from "@/app/constant";

export async function OPTIONS() {
  return new NextResponse("OK", {
    headers: {
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET(req: NextRequest) {
  const authResult = auth(req, ModelProvider.GPT);
  if (authResult.error) {
    return NextResponse.json(authResult, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const limit = parseInt(searchParams.get("limit") || "10", 10);

  if (!q.trim()) {
    return NextResponse.json(
      { success: false, message: "missing q" },
      { status: 400 },
    );
  }

  const clampedLimit = Math.max(1, Math.min(30, isNaN(limit) ? 10 : limit));

  const base = process.env.PINTEREST_PROXY_URL;
  if (!base) {
    return NextResponse.json(
      { success: false, message: "missing PINTEREST_PROXY_URL" },
      { status: 500 },
    );
  }
  const safeBase = base.replace(/\/$/, "");
  const target = `${safeBase}/api/pinterest/search?q=${encodeURIComponent(
    q,
  )}&limit=${clampedLimit}`;

  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent": req.headers.get("user-agent") || "NextChat-Pinterest",
        Accept: "application/json",
      },
      redirect: "follow",
      cache: "no-store",
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, message: e?.message || "fetch failed" },
      { status: 502 },
    );
  }
}
