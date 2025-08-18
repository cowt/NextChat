import { NextRequest, NextResponse } from "next/server";

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
  const { searchParams } = new URL(req.url);
  const target = searchParams.get("url");
  if (!target) {
    return NextResponse.json(
      { error: true, message: "missing url" },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(target, {
      // 避免携带任何敏感首部，降低被拒绝概率
      headers: {
        "User-Agent": req.headers.get("user-agent") || "NextChat-ImageProxy",
        Accept: "*/*",
      },
      redirect: "follow",
      cache: "no-store",
    });

    const contentType =
      res.headers.get("content-type") || "application/octet-stream";
    const resp = new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
    });
    return resp;
  } catch (e: any) {
    return NextResponse.json(
      { error: true, message: e?.message || "fetch failed" },
      { status: 502 },
    );
  }
}
