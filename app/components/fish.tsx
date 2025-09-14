import React from "react";
import styles from "./fish.module.scss";

type FishSwimProps = {
  text?: string;
  durationSec?: number;
  className?: string;
  style?: React.CSSProperties;
  vertical?: "none" | "sine" | "jump";
  amplitude?: string; // e.g. '0.6em'
  accelerate?: boolean; // use burst-like swim curve
  jumpDurationSec?: number; // for jump mode
};

type CSSVars = React.CSSProperties & { [key: string]: string | number };

export default function FishSwim({
  text = "><))))>",
  durationSec = 6,
  className,
  style,
  vertical = "none",
  amplitude = "0.6em",
  accelerate = false,
  jumpDurationSec = 1.5,
}: FishSwimProps) {
  const headChar = text.charAt(0) || ">";
  const bodyText = text.slice(1) || "<))))>";

  const cssVars: CSSVars = {
    ...(style || {}),
    ["--duration"]: `${durationSec}s`,
    ["--fish-ch"]: text.length,
    ["--amplitude"]: amplitude,
    ["--jump-duration"]: `${jumpDurationSec}s`,
  };

  return (
    <div className={`${styles.container} ${className ?? ""}`} style={cssVars}>
      <div
        className={`${styles.fish} ${
          accelerate ? styles["fish-accelerate"] : ""
        }`}
        role="img"
        aria-label="swimming-fish"
      >
        <span className={styles.head}>{headChar}</span>
        <span className={styles.body}>{bodyText}</span>
      </div>
      {vertical !== "none" && (
        <div
          className={`${styles.motion} ${
            vertical === "sine"
              ? styles["vertical-sine"]
              : styles["vertical-jump"]
          }`}
          aria-hidden
        >
          {/* vertical motion layer, affects perceived Y without altering X path */}
        </div>
      )}
    </div>
  );
}
