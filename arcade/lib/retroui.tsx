"use client";

import {
  useMemo,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

/**
 * Thin React 19 / Next 16 wrappers around pixel-retroui 2.1.0's published CSS.
 * The npm JS bundle cannot be compiled by Next 16 Turbopack (`node:fs/promises`
 * in its merged client graph). Visuals and props follow
 * https://retroui.io/installation (BSD-3-Clause).
 */

function pixelBorder(color: string | undefined) {
  const fill = color || "currentColor";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path d="M3 1h1v1h-1zM4 1h1v1h-1zM2 2h1v1h-1zM5 2h1v1h-1zM1 3h1v1h-1zM6 3h1v1h-1zM1 4h1v1h-1zM6 4h1v1h-1zM2 5h1v1h-1zM5 5h1v1h-1zM3 6h1v1h-1zM4 6h1v1h-1z" fill="${fill}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function Button({
  children,
  className = "",
  bg,
  textColor,
  shadow,
  borderColor,
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  bg?: string;
  textColor?: string;
  shadow?: string;
  borderColor?: string;
}) {
  const borderImageSource = useMemo(() => pixelBorder(borderColor), [borderColor]);
  const customStyle = {
    ...style,
    "--button-custom-bg": bg,
    "--button-custom-text": textColor,
    "--button-custom-shadow": shadow,
    "--button-custom-border": borderColor,
    borderImageSource,
  } as CSSProperties;

  return (
    <button
      className={`Button-module__pixelButton___8EYeN ${className} p-0`}
      style={customStyle}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className = "",
  bg,
  textColor,
  borderColor,
  shadowColor,
  style,
}: {
  children?: ReactNode;
  className?: string;
  bg?: string;
  textColor?: string;
  borderColor?: string;
  shadowColor?: string;
  style?: CSSProperties;
}) {
  const borderImageSource = useMemo(() => pixelBorder(borderColor), [borderColor]);
  const customStyle = {
    ...style,
    "--card-custom-bg": bg,
    "--card-custom-text": textColor,
    "--card-custom-border": borderColor,
    "--card-custom-shadow": shadowColor,
    borderImageSource,
  } as CSSProperties;

  return (
    <div className={`Card-module__pixelCard___RY5ZX ${className}`} style={customStyle}>
      {children}
    </div>
  );
}

export function Input({
  className = "",
  icon,
  onIconClick,
  bg,
  textColor,
  borderColor,
  style,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "style"> & {
  icon?: string;
  onIconClick?: () => void;
  bg?: string;
  textColor?: string;
  borderColor?: string;
  style?: CSSProperties;
}) {
  const borderImageSource = useMemo(() => pixelBorder(borderColor), [borderColor]);
  const customStyle = {
    ...style,
    "--input-custom-bg": bg,
    "--input-custom-text": textColor,
    "--input-custom-border": borderColor,
    borderImageSource,
  } as CSSProperties;

  return (
    <div className={`Input-module__pixelContainer___q-uvd relative mx-1 my-2 ${className}`} style={customStyle}>
      <input className="Input-module__pixelInput___iCtVe w-full pr-7 font-minecraft" {...props} />
      {icon ? (
        <button
          className="Input-module__pixelInputIconButton___RE0AJ absolute right-0 top-0"
          onClick={onIconClick}
          type="button"
        >
          <img src={icon} alt="" className="w-5 h-5" />
        </button>
      ) : null}
    </div>
  );
}

const PROGRESS_SIZE = {
  sm: "ProgressBar-module__pixelProgressbarSm___bcfOY",
  md: "ProgressBar-module__pixelProgressbarMd___EBy8U",
  lg: "ProgressBar-module__pixelProgressbarLg___b2T9x",
} as const;

export function ProgressBar({
  progress,
  className = "",
  size = "md",
  color,
  borderColor,
}: {
  progress: number;
  className?: string;
  size?: "sm" | "md" | "lg";
  color?: string;
  borderColor?: string;
}) {
  const clamped = Math.min(Math.max(progress, 0), 100);
  const borderImageSource = useMemo(() => pixelBorder(borderColor), [borderColor]);
  const customStyle = {
    "--progressbar-custom-color": color,
    "--progressbar-custom-border-color": borderColor,
    borderImageSource,
  } as CSSProperties;

  return (
    <div
      className={`ProgressBar-module__pixelProgressbarContainer___eQrfa ${PROGRESS_SIZE[size]} ${className}`.trim()}
      style={customStyle}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="ProgressBar-module__pixelProgressbar___naQch" style={{ width: `${clamped}%` }} />
    </div>
  );
}
