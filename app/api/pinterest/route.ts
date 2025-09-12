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
  const limit = parseInt(searchParams.get("limit") || "10", 20);

  if (!q.trim()) {
    return NextResponse.json(
      { success: false, message: "missing q" },
      { status: 400 },
    );
  }

  const clampedLimit = limit;

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

    // optimize pinterest image url for CN users via proxy prefix, fallback to original urls
    const imageProxyPrefix = process.env.PINTEREST_IMAGE_PROXY_PREFIX || "";

    const countryFromGeo = (req as any).geo?.country as string | undefined;
    const countryFromVercel =
      req.headers.get("x-vercel-ip-country") || undefined;
    const countryFromCF =
      req.headers.get("cf-ipcountry") ||
      req.headers.get("cf-ip-country") ||
      undefined;

    const isCN = [countryFromGeo, countryFromVercel, countryFromCF]
      .filter(Boolean)
      .some((c) => c?.toUpperCase() === "CN");

    const shouldRewrite = !!imageProxyPrefix && isCN;

    const pinimgRegex = /^https?:\/\/i\.pinimg\.com\//i;

    function toProxy(url: string): string {
      const safePrefix = imageProxyPrefix.endsWith("/")
        ? imageProxyPrefix.slice(0, -1)
        : imageProxyPrefix;
      return `${safePrefix}/${encodeURIComponent(url)}`;
    }

    function rewriteValue(value: any): any {
      if (!shouldRewrite) return value;
      if (typeof value === "string" && pinimgRegex.test(value)) {
        try {
          return toProxy(value);
        } catch {
          // fallback to original url if building proxy url failed
          return value;
        }
      }
      if (Array.isArray(value)) return value.map(rewriteValue);
      if (value && typeof value === "object") {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) out[k] = rewriteValue(v);
        return out;
      }
      return value;
    }

    const transformed = rewriteValue(data);
    return NextResponse.json(transformed, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, message: e?.message || "fetch failed" },
      { status: 502 },
    );
  }
}
