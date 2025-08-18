import React, { useEffect, useRef, useState } from "react";
import styles from "./foldable-content.module.scss";
import LightIcon from "../icons/light.svg";

export function FoldableContent(props: {
  title?: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
  previewText?: string;
  showTypingPreview?: boolean;
  icon?: React.ReactNode;
  showChevron?: boolean;
}) {
  const {
    title,
    defaultCollapsed = true,
    children,
    previewText,
    showTypingPreview = true,
    icon,
    showChevron = true,
  } = props;
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);

  // 计算预览最多 3 行：line1/line2（弱化） + currLine（打字机/幽灵）
  const [line1, line2, currLine] = (() => {
    const raw = (previewText ?? "").replace(/\r/g, "");
    // 规范化：去掉代码围栏、HTML/XML 标签、多余空白
    let text = raw
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (text.length === 0) return ["", "", ""];

    const byLines = text.split("\n").filter(Boolean);
    if (byLines.length >= 3) {
      const l3 = byLines[byLines.length - 1];
      const l2 = byLines[byLines.length - 2];
      const l1 = byLines[byLines.length - 3];
      return [l1, l2, l3];
    }
    if (byLines.length === 2) {
      const l3 = byLines[1];
      const l2 = byLines[0];
      return ["", l2, l3];
    }

    // 无换行：根据词边界切为 3 段（近似 36/36/剩余）
    const splitByLen = (input: string, len: number) => {
      if (input.length <= len) return [input, ""] as [string, string];
      let idx = input.lastIndexOf(" ", len);
      if (idx < len * 0.6) idx = len;
      return [input.slice(0, idx).trim(), input.slice(idx).trimStart()] as [
        string,
        string,
      ];
    };
    const [p1, rest1] = splitByLen(text, 36);
    const [p2, p3] = splitByLen(rest1, 36);
    return [p1, p2, p3];
  })();

  // 文字型“打字机”效果：仅在内容增长（流式）时执行，完成后静态展示
  const [typedText, setTypedText] = useState<string>(currLine);
  const prevLenRef = useRef<number>((previewText ?? "").length);
  const typingTimerRef = useRef<number | null>(null);
  const [isTyping, setIsTyping] = useState<boolean>(false);

  useEffect(() => {
    const nextLen = (previewText ?? "").length;
    const prevLen = prevLenRef.current;
    const isGrowing = nextLen > prevLen;
    prevLenRef.current = nextLen;

    if (!collapsed || !showTypingPreview) {
      // 展开或不需要打字机时，直接展示完整文本
      setTypedText(currLine);
      return;
    }

    // 若文本在增长，则执行打字机；否则直接展示
    if (isGrowing) {
      setIsTyping(true);
      // 清理上一次的定时器
      if (typingTimerRef.current) {
        window.clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      setTypedText("");
      let index = 0;
      const target = currLine;
      const step = () => {
        index += 1;
        setTypedText(target.slice(0, index));
        if (index >= target.length && typingTimerRef.current) {
          window.clearInterval(typingTimerRef.current);
          typingTimerRef.current = null;
          setIsTyping(false);
        }
      };
      // 动画频率：约每 16ms 一个字符，兼顾性能
      typingTimerRef.current = window.setInterval(step, 16);
      return () => {
        if (typingTimerRef.current) {
          window.clearInterval(typingTimerRef.current);
          typingTimerRef.current = null;
        }
      };
    } else {
      setTypedText(currLine);
      setIsTyping(false);
    }
  }, [previewText, collapsed, showTypingPreview, currLine]);

  return (
    <div className={`${styles.wrap} foldable-content_wrap`}>
      <div
        className={styles.summary}
        role="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className={styles.left}>
          <span className={styles.icon} aria-hidden="true">
            {icon ?? <LightIcon />}
          </span>
          <div className={styles.meta}>
            <div className={styles.header}>
              {collapsed ? title ?? "思考中" : title ?? "展开内容"}
            </div>
            {collapsed &&
              showTypingPreview &&
              (previewText?.length ?? 0) > 0 && (
                <div className={styles.preview}>
                  {line1 && <div className={styles.previous}>{line1}</div>}
                  {line2 && <div className={styles.previous}>{line2}</div>}
                  <div className={`${styles.typing} ${styles.ghost}`}>
                    <span className={styles.line} data-text={typedText}>
                      {typedText}
                    </span>
                  </div>
                </div>
              )}
          </div>
          {showChevron && (
            <span className={styles.chevronInline} aria-hidden="true">
              ›
            </span>
          )}
        </div>
      </div>
      {!collapsed && <div className={styles.content}>{children}</div>}
    </div>
  );
}

export default FoldableContent;
