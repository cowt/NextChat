/* eslint-disable @next/next/no-img-element */
import ReactMarkdown from "react-markdown";
import "katex/dist/katex.min.css";
import RemarkMath from "remark-math";
import RemarkBreaks from "remark-breaks";
import RehypeKatex from "rehype-katex";
import RemarkGfm from "remark-gfm";
import RehypeHighlight from "rehype-highlight";
import { useRef, useState, RefObject, useEffect, useMemo } from "react";
import { copyToClipboard, useWindowSize } from "../utils";
import mermaid from "mermaid";
import Locale from "../locales";
import LoadingIcon from "../icons/three-dots.svg";
import ReloadButtonIcon from "../icons/reload.svg";
import React from "react";
import { useDebouncedCallback } from "use-debounce";
import { showImageModal, FullScreen } from "./ui-lib";
import {
  ArtifactsShareButton,
  HTMLPreview,
  HTMLPreviewHandler,
} from "./artifacts";
import { useChatStore } from "../store";
import { IconButton } from "./button";

import { useAppConfig } from "../store/config";
import clsx from "clsx";
import FoldableContent from "./foldable-content";
import { MediaOptionSelector } from "./media-option-selector";
import { OptimizedImage } from "./optimized-image";

// Memoized image component with CLS prevention，统一为外链图片走本地代理并带回退
const MarkdownImage = React.memo(
  (imgProps: any) => {
    const [imageDimensions, setImageDimensions] = React.useState<{
      width?: number;
      height?: number;
      aspectRatio?: string;
    }>({});
    const isAliveRef = React.useRef(true);
    // 当前用于展示的图片 src，默认基于原始 src 计算（外链→代理）
    const [currentSrc, setCurrentSrc] = React.useState<string | undefined>(
      undefined,
    );

    // 计算是否需要代理
    const computeDisplaySrc = React.useCallback((src?: string) => {
      if (!src) return { display: src, original: src, proxied: src };
      const isLocal =
        src.startsWith("data:") ||
        src.startsWith("blob:") ||
        src.startsWith("file:");
      if (isLocal) {
        return { display: src, original: src, proxied: src };
      }
      // 已经是站内或相对路径，直接使用；否则统一通过代理
      const isAbsolute = /^(https?:)?\/\//i.test(src);
      const isAlreadyProxied = src.startsWith("/api/images/proxy?");
      if (!isAbsolute || isAlreadyProxied) {
        return { display: src, original: src, proxied: src };
      }
      const proxied = `/api/images/proxy?url=${encodeURIComponent(src)}`;
      return { display: proxied, original: src, proxied };
    }, []);

    // 同步 props.src 变更到 currentSrc（优先使用代理）
    React.useEffect(() => {
      const { display } = computeDisplaySrc(imgProps.src);
      setCurrentSrc(display);
    }, [imgProps.src, computeDisplaySrc]);

    React.useEffect(() => {
      return () => {
        isAliveRef.current = false;
      };
    }, []);

    React.useEffect(() => {
      const originalSrc = imgProps.src;
      if (!originalSrc) return;

      // 检查是否为本地图片（base64、blob、file等）
      const isLocalImage =
        originalSrc.startsWith("data:") ||
        originalSrc.startsWith("blob:") ||
        originalSrc.startsWith("file:");

      // 只做预加载；在流式期间不替换src，避免切换导致的闪烁
      const preloadImageForDimensions = async () => {
        try {
          if (isLocalImage) {
            // 对于本地图片，直接获取尺寸，不需要通过imageManager
            const img = new Image();
            img.onload = () => {
              if (isAliveRef.current) {
                setImageDimensions({
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                  aspectRatio: `${img.naturalWidth} / ${img.naturalHeight}`,
                });
              }
            };
            img.onerror = () => {
              // 本地图片尺寸获取失败，静默处理
            };
            img.src = originalSrc;

            // 将本地图片（blob:/data:）固化到 ServiceWorker 文件缓存
            try {
              // 仅处理 blob:/data:，file: 无法在浏览器中抓取
              if (
                (originalSrc.startsWith("blob:") ||
                  originalSrc.startsWith("data:")) &&
                isAliveRef.current
              ) {
                // 确认 ServiceWorker 已接管页面；否则跳过（避免请求落到服务端 /api/cache/upload）
                try {
                  if (
                    typeof navigator === "undefined" ||
                    !navigator.serviceWorker ||
                    !navigator.serviceWorker.controller
                  ) {
                    throw new Error("sw not controlling");
                  }
                } catch (_) {
                  // SW 未接管，跳过固化
                  return;
                }
                const resp = await fetch(originalSrc);
                if (resp.ok) {
                  const blob = await resp.blob();
                  const extFromType =
                    (blob.type || "").split("/").pop() || "bin";
                  const file = new File([blob], `image.${extFromType}`, {
                    type: blob.type || "application/octet-stream",
                  });
                  const form = new FormData();
                  form.append("file", file);
                  const uploadResp = await fetch("/api/cache/upload", {
                    method: "POST",
                    body: form,
                  });
                  if (uploadResp.ok && isAliveRef.current) {
                    const json = await uploadResp.json().catch(() => null);
                    const stableUrl = json?.data;
                    // 仅在非流式渲染阶段切换到稳定URL，避免流式期间src突变
                    if (
                      stableUrl &&
                      !useChatStore
                        .getState()
                        .currentSession()
                        .messages.some((m) => m.streaming)
                    ) {
                      try {
                        // 先预加载稳定URL，加载完成后再切换，避免闪烁
                        await new Promise<void>((resolve, reject) => {
                          const img = new Image();
                          img.onload = () => resolve();
                          img.onerror = () => resolve(); // 失败也不阻断
                          img.src = stableUrl;
                        });
                        if (isAliveRef.current) {
                          setCurrentSrc(stableUrl);
                        }
                      } catch (_) {}
                    }
                  }
                }
              }
            } catch (_) {}
          } else {
            // 远程图片：不再额外预加载或上传，避免与 <img> 自身请求重复
            // 尺寸与稳定URL持久化改到 onLoad 回调中处理
          }
        } catch (error) {
          // 预加载失败不影响显示，静默处理
        }
      };

      preloadImageForDimensions();

      // 清理函数，防止组件卸载后的状态更新
      return () => {
        isAliveRef.current = false;
      };
    }, [imgProps.src]);

    // 计算样式，优先使用aspect-ratio避免CLS
    const imageStyle = useMemo(() => {
      const baseStyle = imgProps.style || {};

      // 检查是否为本地图片
      const isLocalImage =
        imgProps.src?.startsWith("data:") ||
        imgProps.src?.startsWith("blob:") ||
        imgProps.src?.startsWith("file:");

      if (imageDimensions.aspectRatio) {
        return {
          ...baseStyle,
          aspectRatio: imageDimensions.aspectRatio,
          maxWidth: "100%",
          height: "auto",
        };
      } else if (imageDimensions.width && imageDimensions.height) {
        return {
          ...baseStyle,
          width: Math.min(imageDimensions.width, 800), // 限制最大宽度
          height: "auto",
        };
      }

      // 本地图片不需要占位样式，直接显示
      if (isLocalImage) {
        return {
          ...baseStyle,
          maxWidth: "100%",
          height: "auto",
        };
      }

      // 默认占位样式：去除最小高度以避免在缩小视窗时拉伸变形
      return {
        ...baseStyle,
        maxWidth: "100%",
        height: "auto",
      };
    }, [imageDimensions, imgProps.style, imgProps.src]);

    // 统一使用 currentSrc 渲染；加载失败时尝试在原始与代理之间回退
    const handleImgLoad = async (e: React.SyntheticEvent<HTMLImageElement>) => {
      // no-op: 开发日志已移除
      const img = e.currentTarget;
      if (isAliveRef.current) {
        setImageDimensions({
          width: img.naturalWidth,
          height: img.naturalHeight,
          aspectRatio: `${img.naturalWidth} / ${img.naturalHeight}`,
        });
      }
    };

    return (
      <img
        src={currentSrc}
        alt={imgProps.alt || ""}
        title={imgProps.title}
        className={imgProps.className}
        style={imageStyle}
        loading={imgProps.src?.startsWith("data:") ? "eager" : "lazy"}
        decoding="async"
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        onLoad={handleImgLoad}
        onError={() => {
          // no-op: 开发日志已移除
          try {
            const { original, proxied } = computeDisplaySrc(imgProps.src);
            if (currentSrc === proxied && original) {
              setCurrentSrc(original);
            } else if (currentSrc === original && proxied) {
              setCurrentSrc(proxied);
            }
          } catch (_) {}
        }}
      />
    );
  },
  (prevProps, nextProps) => {
    // 更严格的比较函数，只有真正必要的属性变化时才重新渲染
    // 避免因为style或其他属性变化导致重挂载
    return (
      prevProps.src === nextProps.src &&
      prevProps.alt === nextProps.alt &&
      prevProps.title === nextProps.title &&
      prevProps.className === nextProps.className &&
      prevProps.style === nextProps.style
    );
  },
);

MarkdownImage.displayName = "MarkdownImage";

// placeholder for nested triple backticks inside fold bodies
const BACKTICK_PLACEHOLDER = "__BACKTICK_TRIPLE_PLACEHOLDER__";

export function Mermaid(props: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (props.code && ref.current) {
      mermaid
        .run({
          nodes: [ref.current],
          suppressErrors: true,
        })
        .catch((e) => {
          setHasError(true);
          console.error("[Mermaid] ", e.message);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.code]);

  function viewSvgInNewWindow() {
    const svg = ref.current?.querySelector("svg");
    if (!svg) return;
    const text = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([text], { type: "image/svg+xml" });
    showImageModal(URL.createObjectURL(blob));
  }

  if (hasError) {
    return null;
  }

  return (
    <div
      className={clsx("no-dark", "mermaid")}
      style={{
        cursor: "pointer",
        overflow: "auto",
      }}
      ref={ref}
      onClick={() => viewSvgInNewWindow()}
    >
      {props.code}
    </div>
  );
}

export function PreCode(props: { children: any; isStreaming?: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const previewRef = useRef<HTMLPreviewHandler>(null);
  const [mermaidCode, setMermaidCode] = useState("");
  const [htmlCode, setHtmlCode] = useState("");
  const [foldCollapsed, setFoldCollapsed] = useState(true);
  const { height } = useWindowSize();
  const chatStore = useChatStore();
  const session = chatStore.currentSession();

  const renderArtifacts = useDebouncedCallback(() => {
    // 在流式渲染期间不渲染artifacts，避免布局跳动
    if (props.isStreaming) return;

    if (!ref.current) return;
    const mermaidDom = ref.current.querySelector("code.language-mermaid");
    if (mermaidDom) {
      setMermaidCode((mermaidDom as HTMLElement).innerText);
    }
    const htmlDom = ref.current.querySelector("code.language-html");
    const refText = ref.current.querySelector("code")?.innerText;
    if (htmlDom) {
      setHtmlCode((htmlDom as HTMLElement).innerText);
    } else if (
      refText?.startsWith("<!DOCTYPE") ||
      refText?.startsWith("<svg") ||
      refText?.startsWith("<?xml")
    ) {
      setHtmlCode(refText);
    }
  }, 600);

  const config = useAppConfig();
  const enableArtifacts =
    session.mask?.enableArtifacts !== false && config.enableArtifacts;

  //Wrap the paragraph for plain-text
  useEffect(() => {
    if (ref.current) {
      const codeElements = ref.current.querySelectorAll(
        "code",
      ) as NodeListOf<HTMLElement>;
      const wrapLanguages = [
        "",
        "md",
        "markdown",
        "text",
        "txt",
        "plaintext",
        "tex",
        "latex",
      ];
      codeElements.forEach((codeElement) => {
        let languageClass = codeElement.className.match(/language-(\w+)/);
        let name = languageClass ? languageClass[1] : "";
        if (wrapLanguages.includes(name)) {
          codeElement.style.whiteSpace = "pre-wrap";
        }
      });

      // 只在非流式状态下渲染artifacts
      if (!props.isStreaming) {
        setTimeout(renderArtifacts, 1);
      }
    }
  }, [props.isStreaming]);

  // If this is a special fold block (from ```` fenced), render a wrapper where
  // the summary is at the top level, and the <pre> sits inside the wrapper.
  const child: any = (props as any).children;
  const childClassName = (() => {
    try {
      // Try multiple ways to get the className
      if (React.isValidElement(child)) {
        return (child as any)?.props?.className as string | undefined;
      }
      // If children is an array, check the first element
      if (
        Array.isArray(child) &&
        child.length > 0 &&
        React.isValidElement(child[0])
      ) {
        return (child[0] as any)?.props?.className as string | undefined;
      }
      return undefined;
    } catch (e) {
      return undefined;
    }
  })();
  const isFold =
    (React.isValidElement(child) ||
      (Array.isArray(child) && child.length > 0)) &&
    typeof childClassName === "string" &&
    /language-fold/.test(childClassName);

  if (isFold) {
    // Extract the raw text content from the code element
    const getRawContent = () => {
      try {
        if (Array.isArray(child) && child.length > 0) {
          const codeElement = child[0];
          if (React.isValidElement(codeElement)) {
            const raw = String((codeElement as any)?.props?.children ?? "");
            return raw.replaceAll(BACKTICK_PLACEHOLDER, "```");
          }
        }
        return "";
      } catch (e) {
        return "";
      }
    };

    return (
      <FoldableContent
        defaultCollapsed={foldCollapsed}
        previewText={getRawContent()}
        showTypingPreview
      >
        <MarkdownContent
          content={getRawContent()}
          allowXmlFold={false}
          isStreaming={props.isStreaming}
        />
      </FoldableContent>
    );
  }

  return (
    <>
      <pre ref={ref}>
        <span
          className="copy-code-button"
          onClick={() => {
            if (ref.current) {
              copyToClipboard(
                ref.current.querySelector("code")?.innerText ?? "",
              );
            }
          }}
        ></span>
        {props.children}
      </pre>
      {/* 只在非流式状态下渲染Mermaid和HTML预览 */}
      {!props.isStreaming && mermaidCode.length > 0 && (
        <Mermaid code={mermaidCode} key={mermaidCode} />
      )}
      {!props.isStreaming && htmlCode.length > 0 && enableArtifacts && (
        <FullScreen className="no-dark html" right={70}>
          <ArtifactsShareButton
            style={{ position: "absolute", right: 20, top: 10 }}
            getCode={() => htmlCode}
          />
          <IconButton
            style={{ position: "absolute", right: 120, top: 10 }}
            bordered
            icon={<ReloadButtonIcon />}
            shadow
            onClick={() => previewRef.current?.reload()}
          />
          <HTMLPreview
            ref={previewRef}
            code={htmlCode}
            autoHeight={!document.fullscreenElement}
            height={!document.fullscreenElement ? 600 : height}
          />
        </FullScreen>
      )}
    </>
  );
}

function CustomCode(props: {
  children: any;
  className?: string;
  isStreaming?: boolean;
}) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const config = useAppConfig();
  const enableCodeFold =
    session.mask?.enableCodeFold !== false && config.enableCodeFold;

  const ref = useRef<HTMLPreElement>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [showToggle, setShowToggle] = useState(false);

  const languageClass = props?.className?.match(/language-([\w-]+)/);
  const languageName = languageClass ? languageClass[1] : "";

  useEffect(() => {
    if (ref.current) {
      const codeHeight = ref.current.scrollHeight;
      setShowToggle(codeHeight > 400);

      // 只在非流式状态下自动滚动到底部，避免干扰用户
      if (!props.isStreaming) {
        ref.current.scrollTop = ref.current.scrollHeight;
      }
    }
  }, [props.children, props.isStreaming]);

  const toggleCollapsed = () => {
    setCollapsed((collapsed) => !collapsed);
  };
  const renderShowMoreButton = () => {
    if (showToggle && enableCodeFold && collapsed) {
      return (
        <div
          className={clsx("show-hide-button", {
            collapsed,
            expanded: !collapsed,
          })}
        >
          <button onClick={toggleCollapsed}>{Locale.NewChat.More}</button>
        </div>
      );
    }
    return null;
  };
  return (
    <>
      <code
        className={clsx(languageName ? `language-${languageName}` : undefined)}
        ref={ref}
        style={{
          maxHeight: enableCodeFold && collapsed ? "400px" : "none",
          overflowY: "hidden",
        }}
      >
        {props.children}
      </code>

      {renderShowMoreButton()}
    </>
  );
}

function escapeBrackets(text: string) {
  const pattern =
    /(```[\s\S]*?```|`.*?`)|\\\[([\s\S]*?[^\\])\\\]|\\\((.*?)\\\)/g;
  return text.replace(
    pattern,
    (match, codeBlock, squareBracket, roundBracket) => {
      if (codeBlock) {
        return codeBlock;
      } else if (squareBracket) {
        return `$$${squareBracket}$$`;
      } else if (roundBracket) {
        return `$${roundBracket}$`;
      }
      return match;
    },
  );
}

function tryWrapHtmlCode(text: string) {
  // try add wrap html code (fixed: html codeblock include 2 newline)
  // ignore embed codeblock
  if (text.includes("```")) {
    return text;
  }
  return text
    .replace(
      /([`]*?)(\w*?)([\n\r]*?)(<!DOCTYPE html>)/g,
      (match, quoteStart, lang, newLine, doctype) => {
        return !quoteStart ? "\n```html\n" + doctype : match;
      },
    )
    .replace(
      /(<\/body>)([\r\n\s]*?)(<\/html>)([\n\r]*)([`]*)([\n\r]*?)/g,
      (match, bodyEnd, space, htmlEnd, newLine, quoteEnd) => {
        return !quoteEnd ? bodyEnd + space + htmlEnd + "\n```\n" : match;
      },
    );
}

// Convert 4-backtick fenced blocks to a special fold fence that we can render collapsible.
function convertFourBackticksToFold(text: string) {
  return text.replace(
    /````([^\r\n]*)?[\r\n]([\s\S]*?)[\r\n]````/g,
    (match, info, body) => {
      const rawInfo = (info ?? "").trim();
      const firstToken = rawInfo.split(/[\t\s]+/)[0] ?? "";
      const langFromInfo = firstToken.length > 0 ? firstToken : rawInfo;
      const foldLang =
        langFromInfo.length > 0 ? `fold-${langFromInfo}` : "fold";
      // Encode inner triple backticks to avoid prematurely closing the fence.
      const safeBody = String(body).replaceAll("```", BACKTICK_PLACEHOLDER);
      return `\n\n\`\`\`${foldLang}\n${safeBody}\n\`\`\`\n\n`;
    },
  );
}

// Convert configured XML-like tags to a special fold fence
function convertXmlTagsToFold(text: string, tags: string[]) {
  let result = text;
  for (const tag of tags || []) {
    // 支持大小写、可选属性、以及标签内外的任意空白
    const re = new RegExp(`<${tag}[^>]*>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "gi");
    result = result.replace(re, (m, body) => {
      const safeBody = String(body).replaceAll("```", BACKTICK_PLACEHOLDER);
      return `\n\n\`\`\`fold-${tag}\n${safeBody}\n\`\`\`\n\n`;
    });
  }
  return result;
}

// 当出现左标签而未闭合时，也先包一层折叠，直到文本末尾
function convertLeftTagOpenToFold(text: string, tags: string[]) {
  let result = text;
  for (const tag of tags || []) {
    const open = new RegExp(`<${tag}[^>]*>`, "i");
    const close = new RegExp(`</${tag}>`, "i");
    if (open.test(result) && !close.test(result)) {
      result = result.replace(open, (m) => `\n\n\`\`\`fold-${tag}\n`);
      // 文末补齐围栏
      if (!/\n```\s*$/.test(result)) {
        result = result + `\n\`\`\`\n`;
      }
    }
  }
  return result;
}

// 仅处理“第一层”的 XML-like 标签，将其转换为折叠块；
// 若内部还有同名单/其他受支持标签，不再递归转换。
function convertXmlTagsToFoldFirstLevel(text: string, tags: string[]) {
  if (!tags || tags.length === 0) return text;
  const union = tags
    .map((t) => t.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))
    .join("|");
  const tokenRe = new RegExp(`<\\/?(?:${union})\\b[^>]*>`, "gi");

  let result = "";
  let lastIndex = 0;
  type Open = { tag: string; openStart: number; bodyStart: number };
  const stack: Open[] = [];
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(text)) !== null) {
    const token = m[0];
    const isClose = token.startsWith("</");
    const tagName = /<\/?([\w-]+)/i.exec(token)?.[1]?.toLowerCase() ?? "";

    if (!isClose) {
      // opening tag
      const openStart = m.index;
      const bodyStart = m.index + token.length;
      stack.push({ tag: tagName, openStart, bodyStart });
    } else {
      // closing tag
      // find the top-most matching same-tag open
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tagName) {
          const open = stack[i];
          const isTopLevel = i === 0; // 第一层：栈底元素
          // pop everything from i to end
          stack.splice(i);
          if (isTopLevel) {
            const closeEnd = m.index + token.length;
            const body = text.slice(open.bodyStart, m.index);
            const safeBody = String(body).replaceAll(
              "```",
              BACKTICK_PLACEHOLDER,
            );
            // 追加前置未变更文本
            result += text.slice(lastIndex, open.openStart);
            result += `\n\n\`\`\`fold-${tagName}\n${safeBody}\n\`\`\`\n\n`;
            lastIndex = closeEnd;
          }
          break;
        }
      }
    }
  }

  // 若存在未闭合的第一层标签，包裹到末尾
  if (stack.length > 0) {
    const first = stack[0];
    const safeBody = String(text.slice(first.bodyStart)).replaceAll(
      "```",
      BACKTICK_PLACEHOLDER,
    );
    result += text.slice(lastIndex, first.openStart);
    result += `\n\n\`\`\`fold-${first.tag}\n${safeBody}\n\`\`\`\n\n`;
    lastIndex = text.length;
  }

  // 拼接剩余尾部文本
  if (lastIndex < text.length) {
    result += text.slice(lastIndex);
  }
  return result || text;
}

function _MarkDownContent(props: {
  content: string;
  allowXmlFold?: boolean;
  isStreaming?: boolean;
}) {
  const config = useAppConfig();

  // 使用ref存储上一次的非流式内容，避免流式过程中重新渲染
  const lastNonStreamingContentRef = useRef<string>("");
  const lastNonStreamingResultRef = useRef<React.ReactElement | null>(null);

  const escapedContent = useMemo(() => {
    // 始终进行结构转换，确保标签折叠功能正常工作
    const withFold = convertFourBackticksToFold(props.content);
    const finalText =
      props.allowXmlFold === false
        ? withFold
        : convertXmlTagsToFoldFirstLevel(withFold, (config as any).foldXmlTags);
    return tryWrapHtmlCode(escapeBrackets(finalText));
  }, [props.content, props.allowXmlFold, config.foldXmlTags]);

  // 在流式阶段禁用语法高亮和数学公式渲染，避免频繁重排
  const rehypePlugins = props.isStreaming
    ? [] // 流式阶段不启用任何rehype插件
    : [
        RehypeKatex,
        [
          RehypeHighlight,
          {
            detect: false,
            ignoreMissing: true,
          },
        ] as any,
      ];

  // 使用useMemo缓存components配置，避免每次渲染都重新创建
  const components = useMemo(
    () => ({
      pre: (preProps: any) => (
        <PreCode {...preProps} isStreaming={props.isStreaming} />
      ),
      code: (codeProps: any) => (
        <CustomCode {...codeProps} isStreaming={props.isStreaming} />
      ),
      input: (inputProps: any) => {
        // 确保复选框可以正常交互
        if (inputProps.type === "checkbox") {
          return (
            <input
              {...inputProps}
              style={{
                cursor: "pointer",
                pointerEvents: "auto",
                ...inputProps.style,
              }}
              onChange={() => {
                // 让我们的事件处理器处理
              }}
            />
          );
        }
        return <input {...inputProps} />;
      },
      img: (imgProps: any) => {
        // 使用更稳定的key，包含alt和title信息，避免因其他属性变化导致重挂载
        const stableKey = `${imgProps.src}-${imgProps.alt || ""}-${
          imgProps.title || ""
        }`;
        return <MarkdownImage key={stableKey} {...imgProps} />;
      },
      p: (pProps: any) => <p {...pProps} dir="auto" />,
      a: (aProps: any) => {
        const href = aProps.href || "";
        if (/\.(aac|mp3|opus|wav)$/.test(href)) {
          return (
            <figure>
              <audio controls src={href}></audio>
            </figure>
          );
        }
        if (/\.(3gp|3g2|webm|ogv|mpeg|mp4|avi)$/.test(href)) {
          return (
            <video controls width="99.9%">
              <source src={href} />
            </video>
          );
        }
        const isInternal = /^\/#/i.test(href);
        const target = isInternal ? "_self" : aProps.target ?? "_blank";
        return <a {...aProps} target={target} />;
      },
    }),
    [props.isStreaming],
  ); // 保留依赖，但优化缓存复用逻辑

  // 在流式阶段，如果内容变化不大且不包含需要折叠的标签，复用上一次的渲染结果
  if (
    props.isStreaming &&
    lastNonStreamingContentRef.current &&
    props.content.startsWith(lastNonStreamingContentRef.current) &&
    lastNonStreamingResultRef.current
  ) {
    // 检查是否包含需要折叠的标签，如果包含则不复用缓存
    const hasFoldableTags = (config as any).foldXmlTags?.some(
      (tag: string) =>
        props.content.includes(`<${tag}`) ||
        props.content.includes(`</${tag}>`),
    );

    // 检查是否只是简单的文本追加（不包含新的图片、代码块等）
    const isSimpleAppend =
      !props.content.includes("![") &&
      !props.content.includes("```") &&
      !props.content.includes("<img") &&
      !hasFoldableTags;

    if (isSimpleAppend) {
      return lastNonStreamingResultRef.current;
    } else if (!hasFoldableTags) {
      return lastNonStreamingResultRef.current;
    }
  }

  // 流结束时，如果内容与缓存内容相同，复用缓存结果
  if (
    !props.isStreaming &&
    props.content &&
    lastNonStreamingContentRef.current === props.content &&
    lastNonStreamingResultRef.current
  ) {
    return lastNonStreamingResultRef.current;
  }

  // 流式阶段，如果内容完全相同，也复用缓存结果
  if (
    props.isStreaming &&
    props.content &&
    lastNonStreamingContentRef.current === props.content &&
    lastNonStreamingResultRef.current
  ) {
    return lastNonStreamingResultRef.current;
  }

  // 非流式阶段或内容变化较大时，正常渲染
  const result = (
    <ReactMarkdown
      remarkPlugins={[RemarkMath, RemarkGfm, RemarkBreaks]}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {escapedContent}
    </ReactMarkdown>
  );

  // 保存非流式阶段的渲染结果
  if (!props.isStreaming) {
    lastNonStreamingContentRef.current = props.content;
    lastNonStreamingResultRef.current = result;
  }

  return result;
}

export const MarkdownContent = React.memo(
  _MarkDownContent,
  (prevProps, nextProps) => {
    // 自定义比较函数，避免不必要的重渲染
    // 只有在内容真正变化时才重新渲染
    if (prevProps.content !== nextProps.content) return false;
    if (prevProps.allowXmlFold !== nextProps.allowXmlFold) return false;
    if (prevProps.isStreaming !== nextProps.isStreaming) return false;

    // 所有属性都相同，可以跳过重渲染
    return true;
  },
);

export function Markdown(
  props: {
    content: string;
    loading?: boolean;
    fontSize?: number;
    fontFamily?: string;
    parentRef?: RefObject<HTMLDivElement>;
    defaultShow?: boolean;
    onImageClick?: (images: string[], index: number) => void;
    onCheckboxToggle?: (text: string, checked: boolean) => void;
    selectedCheckboxItems?: Set<string>;
    isStreaming?: boolean; // 新增流式状态参数
  } & React.DOMAttributes<HTMLDivElement>,
) {
  const mdRef = useRef<HTMLDivElement>(null);
  // 移除无用的allImages状态，改用ref存储
  const allImagesRef = useRef<string[]>([]);

  // 使用事件委托优化事件绑定，避免每次渲染都重新绑定
  useEffect(() => {
    if (!mdRef.current) return;

    const container = mdRef.current;
    const cleanups: Array<() => void> = [];

    // 图片点击事件委托
    if (props.onImageClick) {
      const handleImageClick = (e: Event) => {
        const target = e.target as HTMLImageElement;
        if (target.tagName !== "IMG") return;

        // 检查是否为可预览的图片
        if (target.hasAttribute("data-no-preview") || target.closest("a")) {
          return;
        }

        // 收集所有可预览图片
        const allImgNodes = Array.from(
          container.querySelectorAll<HTMLImageElement>("img"),
        ).filter((img) => {
          if (img.hasAttribute("data-no-preview")) return false;
          return !img.closest("a");
        });

        const imageSrcs = allImgNodes.map((img) => img.src).filter(Boolean);
        const index = allImgNodes.indexOf(target);

        if (index >= 0) {
          e.preventDefault();
          e.stopPropagation();
          props.onImageClick!(imageSrcs, index);
        }
      };

      container.addEventListener("click", handleImageClick);
      cleanups.push(() =>
        container.removeEventListener("click", handleImageClick),
      );
    }

    // 复选框事件委托
    if (props.onCheckboxToggle) {
      const handleCheckboxChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        if (target.type !== "checkbox") return;

        const listItem = target.closest("li");
        if (!listItem) return;

        // 获取复选框所在的列表项文本
        const clonedItem = listItem.cloneNode(true) as HTMLElement;
        const clonedCheckbox = clonedItem.querySelector(
          'input[type="checkbox"]',
        );
        if (clonedCheckbox) {
          clonedCheckbox.remove();
        }
        let textContent = clonedItem.textContent?.trim() || "";

        // 提取媒体URL
        const urlMatch = textContent.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) {
          const url = urlMatch[1];
          const isMediaUrl =
            /\.(jpg|jpeg|png|gif|webp|svg|mp4|mp3|wav|ogg|pdf|doc|docx)$/i.test(
              url,
            ) ||
            url.includes("agent_images") ||
            url.includes("image") ||
            url.includes("media") ||
            url.includes("assets") ||
            url.includes("upload");

          if (isMediaUrl) {
            textContent = url;
          }
        }

        const isChecked = target.checked;
        props.onCheckboxToggle!(textContent, isChecked);
      };

      container.addEventListener("change", handleCheckboxChange);
      cleanups.push(() =>
        container.removeEventListener("change", handleCheckboxChange),
      );
    }

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [props.onImageClick, props.onCheckboxToggle]);

  // 分离样式设置，避免在流式过程中频繁操作DOM
  useEffect(() => {
    if (!mdRef.current) return;

    // 设置可预览图片的样式
    const allImgNodes = Array.from(
      mdRef.current.querySelectorAll<HTMLImageElement>("img"),
    ).filter((img) => {
      if (img.hasAttribute("data-no-preview")) return false;
      return !img.closest("a");
    });

    allImgNodes.forEach((img) => {
      img.style.cursor = "pointer";
    });

    // 设置复选框状态和样式
    const checkboxes = Array.from(
      mdRef.current.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      ),
    );

    checkboxes.forEach((checkbox) => {
      checkbox.style.cursor = "pointer";
      checkbox.style.pointerEvents = "auto";
      checkbox.disabled = false;
      checkbox.readOnly = false;

      // 根据传入的状态设置复选框的选中状态
      if (props.selectedCheckboxItems) {
        const listItem = checkbox.closest("li");
        if (listItem) {
          const clonedItem = listItem.cloneNode(true) as HTMLElement;
          const clonedCheckbox = clonedItem.querySelector(
            'input[type="checkbox"]',
          );
          if (clonedCheckbox) {
            clonedCheckbox.remove();
          }
          let textContent = clonedItem.textContent?.trim() || "";

          const urlMatch = textContent.match(/(https?:\/\/[^\s]+)/);
          if (urlMatch) {
            const url = urlMatch[1];
            const isMediaUrl =
              /\.(jpg|jpeg|png|gif|webp|svg|mp4|mp3|wav|ogg|pdf|doc|docx)$/i.test(
                url,
              ) ||
              url.includes("agent_images") ||
              url.includes("image") ||
              url.includes("media") ||
              url.includes("assets") ||
              url.includes("upload");

            if (isMediaUrl) {
              textContent = url;
            }
          }

          checkbox.checked = props.selectedCheckboxItems.has(textContent);
        }
      }
    });

    // 更新图片引用
    const imageSrcs = allImgNodes.map((img) => img.src).filter(Boolean);
    allImagesRef.current = imageSrcs;
  }, [props.content, props.selectedCheckboxItems]);

  return (
    <div
      className="markdown-body"
      style={{
        fontSize: `${props.fontSize ?? 14}px`,
        fontFamily: props.fontFamily || "inherit",
      }}
      ref={mdRef}
      onContextMenu={props.onContextMenu}
      onDoubleClickCapture={props.onDoubleClickCapture}
      dir="auto"
    >
      {props.loading ? (
        <LoadingIcon />
      ) : (
        <>
          {/* 原有的 Markdown 内容 */}
          <MarkdownContent
            content={props.content}
            isStreaming={props.isStreaming}
          />

          {/* 媒体选项选择器（移动到结尾处渲染） */}
          {(() => {
            return (
              <MediaOptionSelector
                content={props.content}
                onOptionSelect={(option, selected) => {
                  // 选中后仅填入选项内容（纯文本/URL），不要附加格式
                  if (props.onCheckboxToggle)
                    props.onCheckboxToggle(
                      option.imageUrl || option.originalText,
                      selected,
                    );
                }}
                selectedOptions={props.selectedCheckboxItems}
              />
            );
          })()}
        </>
      )}
    </div>
  );
}
