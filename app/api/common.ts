import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "../config/server";
import { OPENAI_BASE_URL, ServiceProvider } from "../constant";
import { cloudflareAIGatewayUrl } from "../utils/cloudflare";
import { getModelProvider, isModelNotavailableInServer } from "../utils/model";

const serverConfig = getServerSideConfig();

export async function requestOpenai(req: NextRequest) {
  const controller = new AbortController();

  const isAzure = req.nextUrl.pathname.includes("azure/deployments");

  var authValue,
    authHeaderName = "";
  if (isAzure) {
    authValue =
      req.headers
        .get("Authorization")
        ?.trim()
        .replaceAll("Bearer ", "")
        .trim() ?? "";

    authHeaderName = "api-key";
  } else {
    const isSummaryReq =
      req.headers.get("x-nextchat-summary") === "1" ||
      req.headers.get("x-nextchat-summary") === "true";
    const authSource = req.headers.get("x-nextchat-auth-source") || "";
    // 当为摘要请求且通过了前端 key/访问码校验（或使用系统 key），允许走摘要通道；
    // 其中优先覆盖为服务端 SUMMARY_API_KEY（更安全，可隐藏用户 key）。
    if (isSummaryReq && serverConfig.summaryApiKey) {
      authValue = `Bearer ${serverConfig.summaryApiKey}`;
    } else {
      authValue = req.headers.get("Authorization") ?? "";
    }
    authHeaderName = "Authorization";
  }

  let path = `${req.nextUrl.pathname}`.replaceAll("/api/openai/", "");

  const isSummary =
    req.headers.get("x-nextchat-summary") === "1" ||
    req.headers.get("x-nextchat-summary") === "true";

  let baseUrl =
    (isAzure
      ? serverConfig.azureUrl
      : isSummary
      ? serverConfig.summaryBaseUrl || serverConfig.baseUrl
      : serverConfig.baseUrl) || OPENAI_BASE_URL;

  if (!baseUrl.startsWith("http")) {
    baseUrl = `https://${baseUrl}`;
  }

  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  if (process.env.DEBUG_PROXY === "true") {
    console.log("[Proxy] ", path);
    console.log("[Base Url]", baseUrl);
  }

  const upstreamTimeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS || "120000");
  const timeoutId = setTimeout(() => controller.abort(), upstreamTimeoutMs);

  if (isAzure) {
    const azureApiVersion =
      req?.nextUrl?.searchParams?.get("api-version") ||
      serverConfig.azureApiVersion;
    baseUrl = baseUrl.split("/deployments").shift() as string;
    path = `${req.nextUrl.pathname.replaceAll(
      "/api/azure/",
      "",
    )}?api-version=${azureApiVersion}`;

    // Forward compatibility:
    // if display_name(deployment_name) not set, and '{deploy-id}' in AZURE_URL
    // then using default '{deploy-id}'
    if (serverConfig.customModels && serverConfig.azureUrl) {
      const modelName = path.split("/")[1];
      let realDeployName = "";
      serverConfig.customModels
        .split(",")
        .filter((v) => !!v && !v.startsWith("-") && v.includes(modelName))
        .forEach((m) => {
          const [fullName, displayName] = m.split("=");
          const [_, providerName] = getModelProvider(fullName);
          if (providerName === "azure" && !displayName) {
            const [_, deployId] = (serverConfig?.azureUrl ?? "").split(
              "deployments/",
            );
            if (deployId) {
              realDeployName = deployId;
            }
          }
        });
      if (realDeployName) {
        console.log("[Replace with DeployId", realDeployName);
        path = path.replaceAll(modelName, realDeployName);
      }
    }
  }

  const fetchUrl = cloudflareAIGatewayUrl(`${baseUrl}/${path}`);
  if (process.env.DEBUG_PROXY === "true") {
    console.log("fetchUrl", fetchUrl);
  }
  const fetchOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      [authHeaderName]: authValue,
      ...(serverConfig.openaiOrgId && {
        "OpenAI-Organization": serverConfig.openaiOrgId,
      }),
    },
    method: req.method,
    body: req.body,
    // to fix #2485: https://stackoverflow.com/questions/55920957/cloudflare-worker-typeerror-one-time-use-body
    redirect: "manual",
    // @ts-ignore
    duplex: "half",
    signal: controller.signal,
  };

  // #1815 try to refuse models not allowed by server
  const isSummaryCheck =
    req.headers.get("x-nextchat-summary") === "1" ||
    req.headers.get("x-nextchat-summary") === "true";
  const allowList = isSummaryCheck
    ? serverConfig.summaryCustomModels
    : serverConfig.customModels;
  if (allowList && req.body) {
    try {
      // 保护：限制读取请求体的最大字节数，避免大体积 JSON 造成内存占用
      const maxInspectBytes = Number(
        process.env.OPENAI_REQUEST_BODY_MAX_INSPECT_SIZE || 512 * 1024,
      );
      const contentLengthHeader = req.headers.get("content-length") || "0";
      const contentLength = Number(contentLengthHeader) || 0;

      if (contentLength > 0 && contentLength > maxInspectBytes) {
        if (process.env.DEBUG_PROXY === "true") {
          console.warn(
            `[Proxy] skip body inspect due to size ${contentLength} > ${maxInspectBytes}`,
          );
        }
        // 跳过模型白名单校验，仅做透明转发，避免占用内存
        fetchOptions.body = req.body as any;
      } else {
        const clonedBody = await req.text();
        fetchOptions.body = clonedBody;
        const jsonBody = JSON.parse(clonedBody) as { model?: string };

        // not undefined and is false
        if (
          isModelNotavailableInServer(allowList, jsonBody?.model as string, [
            ServiceProvider.OpenAI,
            ServiceProvider.Azure,
            jsonBody?.model as string, // support provider-unspecified model
          ])
        ) {
          return NextResponse.json(
            {
              error: true,
              message: `you are not allowed to use ${jsonBody?.model} model`,
            },
            {
              status: 403,
            },
          );
        }
      }
    } catch (e) {
      console.error("[OpenAI] gpt4 filter", e);
    }
  }

  try {
    const res = await fetch(fetchUrl, fetchOptions);

    // Extract the OpenAI-Organization header from the response
    const openaiOrganizationHeader = res.headers.get("OpenAI-Organization");

    // Check if serverConfig.openaiOrgId is defined and not an empty string
    if (serverConfig.openaiOrgId && serverConfig.openaiOrgId.trim() !== "") {
      // If openaiOrganizationHeader is present, log it; otherwise, log that the header is not present
      if (process.env.DEBUG_PROXY === "true") {
        console.log("[Org ID]", openaiOrganizationHeader);
      }
    } else {
      if (process.env.DEBUG_PROXY === "true") {
        console.log("[Org ID] is not set up.");
      }
    }

    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");

    // Conditionally delete the OpenAI-Organization header from the response if [Org ID] is undefined or empty (not setup in ENV)
    // Also, this is to prevent the header from being sent to the client
    if (!serverConfig.openaiOrgId || serverConfig.openaiOrgId.trim() === "") {
      newHeaders.delete("OpenAI-Organization");
    }

    // The latest version of the OpenAI API forced the content-encoding to be "br" in json response
    // So if the streaming is disabled, we need to remove the content-encoding header
    // Because Vercel uses gzip to compress the response, if we don't remove the content-encoding header
    // The browser will try to decode the response with brotli and fail
    newHeaders.delete("content-encoding");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
