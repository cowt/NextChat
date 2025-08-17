export function prettyObject(msg: any) {
  const original = msg;
  // Normalize Error objects into a safe, minimal structure
  if (original instanceof Error) {
    const err = original as any;
    const safe: Record<string, any> = {
      name: err.name,
      message: err.message,
    };
    if (err.code) safe.code = err.code;
    if (err.status) safe.status = err.status;
    // Preserve cause basic info without network identifiers
    if (err.cause) {
      const c = err.cause as any;
      safe.cause = {
        name: c?.name,
        message: c?.message,
        code: c?.code,
      };
    }
    msg = safe;
  }
  const replacer = (key: string, value: any) => {
    const lowerKey = typeof key === "string" ? key.toLowerCase() : key;
    switch (lowerKey) {
      case "host":
      case "hostname":
      case "port":
      case "localaddress":
      case "remoteaddress":
      case "remoteport":
      case "address":
      case "ip":
      case "baseurl":
      case "fetchurl":
      case "origin":
      case "referer":
      case "url":
      case "path":
        return "[REDACTED]";
      default:
        return value;
    }
  };

  if (typeof msg !== "string") {
    try {
      msg = JSON.stringify(msg, replacer, "  ");
    } catch {
      msg = String(original);
    }
  }
  if (msg === "{}") {
    return String(original);
  }
  const redact = (text: string) => {
    let s = text;
    // redact key-like pairs: host: xxx, hostname=xxx, port: 443
    s = s.replace(
      /\b(host|hostname|origin|referer|baseurl|fetchurl|url|path)\b\s*[:=]\s*[^\s,'"\]\}\)]+/gi,
      "$1: [REDACTED]",
    );
    s = s.replace(/\bport\b\s*[:=]\s*\d+/gi, "port: [REDACTED]");
    // redact http(s) urls domain part
    s = s.replace(/https?:\/\/[^\s/]+/gi, (m) => {
      const protocol = m.startsWith("https") ? "https://" : "http://";
      return protocol + "[REDACTED]";
    });
    // redact IPv4 addresses
    s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b(?::\d+)?/g, "[REDACTED_IP]");
    return s;
  };

  if (typeof msg === "string" && msg.startsWith("```json")) {
    return redact(msg);
  }
  return ["```json", redact(msg as string), "```"].join("\n");
}

export function* chunks(s: string, maxBytes = 1000 * 1000) {
  const decoder = new TextDecoder("utf-8");
  let buf = new TextEncoder().encode(s);
  while (buf.length) {
    let i = buf.lastIndexOf(32, maxBytes + 1);
    // If no space found, try forward search
    if (i < 0) i = buf.indexOf(32, maxBytes);
    // If there's no space at all, take all
    if (i < 0) i = buf.length;
    // This is a safe cut-off point; never half-way a multi-byte
    yield decoder.decode(buf.slice(0, i));
    buf = buf.slice(i + 1); // Skip space (if any)
  }
}
