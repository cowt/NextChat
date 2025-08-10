import { NextRequest, NextResponse } from "next/server";

async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  // This endpoint is intended to be intercepted by ServiceWorker.
  // When SW is not yet active, provide a graceful fallback error instead of proxying.
  const action = params?.path?.[0] ?? "";

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  // POST /api/cache/upload
  if (req.method === "POST" && action === "upload") {
    return NextResponse.json(
      {
        code: -1,
        msg: "ServiceWorker 未启用或尚未接管页面，无法在服务端处理上传。请刷新页面以启用离线缓存，或稍后重试。",
      },
      { status: 503 },
    );
  }

  // GET /api/cache/* or DELETE /api/cache/*
  return NextResponse.json(
    {
      code: -1,
      msg: "此接口需由浏览器 ServiceWorker 处理。请刷新页面以启用 ServiceWorker。",
    },
    { status: 404 },
  );
}

export const GET = handle;
export const POST = handle;

export const runtime = "edge";
export const preferredRegion = [
  "arn1",
  "bom1",
  "cdg1",
  "cle1",
  "cpt1",
  "dub1",
  "fra1",
  "gru1",
  "hnd1",
  "iad1",
  "icn1",
  "kix1",
  "lhr1",
  "pdx1",
  "sfo1",
  "sin1",
  "syd1",
];
