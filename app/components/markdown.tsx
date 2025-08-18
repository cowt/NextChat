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

export function PreCode(props: { children: any }) {
  const ref = useRef<HTMLPreElement>(null);
  const previewRef = useRef<HTMLPreviewHandler>(null);
  const [mermaidCode, setMermaidCode] = useState("");
  const [htmlCode, setHtmlCode] = useState("");
  const [foldCollapsed, setFoldCollapsed] = useState(true);
  const { height } = useWindowSize();
  const chatStore = useChatStore();
  const session = chatStore.currentSession();

  const renderArtifacts = useDebouncedCallback(() => {
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
      setTimeout(renderArtifacts, 1);
    }
  }, []);

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
        <MarkdownContent content={getRawContent()} allowXmlFold={false} />
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
      {mermaidCode.length > 0 && (
        <Mermaid code={mermaidCode} key={mermaidCode} />
      )}
      {htmlCode.length > 0 && enableArtifacts && (
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

function CustomCode(props: { children: any; className?: string }) {
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
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [props.children]);

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
      console.log(
        `[DEBUG] Converting 4-backtick block: info="${rawInfo}", foldLang="${foldLang}"`,
      );
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

function _MarkDownContent(props: { content: string; allowXmlFold?: boolean }) {
  const config = useAppConfig();
  const escapedContent = useMemo(() => {
    const withFold = convertFourBackticksToFold(props.content);
    const finalText =
      props.allowXmlFold === false
        ? withFold
        : convertXmlTagsToFoldFirstLevel(withFold, (config as any).foldXmlTags);
    return tryWrapHtmlCode(escapeBrackets(finalText));
  }, [props.content, props.allowXmlFold, config.foldXmlTags]);

  return (
    <ReactMarkdown
      remarkPlugins={[RemarkMath, RemarkGfm, RemarkBreaks]}
      rehypePlugins={[
        RehypeKatex,
        [
          RehypeHighlight,
          {
            detect: false,
            ignoreMissing: true,
          },
        ],
      ]}
      components={{
        pre: PreCode,
        code: CustomCode,
        input: (inputProps) => {
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
        img: (imgProps) => (
          // 优化图片加载：懒加载、异步解码、避免 referrer 引起的 302/签名失效
          <img
            {...imgProps}
            loading={imgProps.loading ?? "lazy"}
            decoding={imgProps.decoding ?? "async"}
            referrerPolicy={imgProps.referrerPolicy ?? "no-referrer"}
          />
        ),
        p: (pProps) => <p {...pProps} dir="auto" />,
        a: (aProps) => {
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
      }}
    >
      {escapedContent}
    </ReactMarkdown>
  );
}

export const MarkdownContent = React.memo(_MarkDownContent);

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
  } & React.DOMAttributes<HTMLDivElement>,
) {
  const mdRef = useRef<HTMLDivElement>(null);
  const [allImages, setAllImages] = useState<string[]>([]);

  // 收集并设置图片点击事件和复选框交互
  useEffect(() => {
    const cleanups: Array<() => void> = [];

    // 处理图片点击事件
    if (mdRef.current && props.onImageClick) {
      const allImgNodes = Array.from(
        mdRef.current.querySelectorAll<HTMLImageElement>("img"),
      );

      // 仅对未被 <a> 包裹的图片启用预览，避免与跳转/外链冲突
      const boundImages = allImgNodes.filter((img) => !img.closest("a"));
      const imageSrcs = boundImages.map((img) => img.src).filter(Boolean);
      setAllImages(imageSrcs);

      // 为每个可预览图片添加点击事件
      boundImages.forEach((img, index) => {
        const handleClick = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          props.onImageClick!(imageSrcs, index);
        };

        img.style.cursor = "pointer";
        img.addEventListener("click", handleClick);
        cleanups.push(() => img.removeEventListener("click", handleClick));
      });
    }

    // 处理复选框交互
    if (mdRef.current && props.onCheckboxToggle) {
      const checkboxes = Array.from(
        mdRef.current.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"]',
        ),
      );

      checkboxes.forEach((checkbox, index) => {
        // 获取复选框所在的列表项文本
        const listItem = checkbox.closest("li");
        if (listItem) {
          // 克隆列表项，移除复选框，然后获取文本
          const clonedItem = listItem.cloneNode(true) as HTMLElement;
          const clonedCheckbox = clonedItem.querySelector(
            'input[type="checkbox"]',
          );
          if (clonedCheckbox) {
            clonedCheckbox.remove();
          }
          let textContent = clonedItem.textContent?.trim() || "";

          // 提取媒体URL - 查找http/https开头的URL
          const urlMatch = textContent.match(/(https?:\/\/[^\s]+)/);
          if (urlMatch) {
            // 如果找到URL，检查是否为媒体文件
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
              textContent = url; // 使用纯净的媒体URL
            }
          }

          // 根据传入的状态设置复选框的选中状态
          if (props.selectedCheckboxItems) {
            checkbox.checked = props.selectedCheckboxItems.has(textContent);
          }

          const handleCheckboxClick = (e: Event) => {
            e.stopPropagation();
            // 使用延迟获取更新后的checked状态
            setTimeout(() => {
              const isChecked = checkbox.checked;
              props.onCheckboxToggle!(textContent, isChecked);
            }, 0);
          };

          // 确保复选框可以被点击
          checkbox.style.cursor = "pointer";
          checkbox.style.pointerEvents = "auto";
          checkbox.disabled = false;
          checkbox.readOnly = false;

          // 处理change事件（标准复选框事件）
          const handleCheckboxChange = (e: Event) => {
            const target = e.target as HTMLInputElement;
            const isChecked = target.checked;
            props.onCheckboxToggle!(textContent, isChecked);
          };

          // 添加事件监听
          checkbox.addEventListener("change", handleCheckboxChange);
          checkbox.addEventListener("click", handleCheckboxClick);

          cleanups.push(() => {
            checkbox.removeEventListener("change", handleCheckboxChange);
            checkbox.removeEventListener("click", handleCheckboxClick);
          });
        }
      });
    }

    // 统一清理，防止重复绑定
    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [
    props.content,
    props.onImageClick,
    props.onCheckboxToggle,
    props.selectedCheckboxItems,
  ]);

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
          <MarkdownContent content={props.content} />

          {/* 媒体选项选择器（移动到结尾处渲染） */}
          {(() => {
            console.log(
              "📄 Markdown 组件渲染，内容长度:",
              props.content.length,
            );
            console.log("📄 内容前200字符:", props.content.substring(0, 200));
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
