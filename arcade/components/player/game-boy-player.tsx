"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Gameboy } from "gameboy-emulator";
import styles from "./game-boy-player.module.css";

type InputControl = "up" | "down" | "left" | "right" | "a" | "b" | "start" | "select";
type PlayerStatus = "loading" | "running" | "error";

function installSilentAudioFallback() {
  if (typeof SharedArrayBuffer !== "undefined") return;
  Object.defineProperty(globalThis, "SharedArrayBuffer", {
    configurable: true,
    value: ArrayBuffer,
  });
}

export function GameBoyPlayer({
  romUrl,
  title,
  onRestart,
  onStatusChange,
}: {
  romUrl: string;
  title: string;
  onRestart: () => void;
  onStatusChange?: (status: PlayerStatus) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameboyRef = useRef<Gameboy | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("loading");

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("Game canvas is unavailable");

      installSilentAudioFallback();
      const [{ Gameboy }, response] = await Promise.all([
        import("gameboy-emulator"),
        fetch(romUrl),
      ]);
      if (!response.ok) throw new Error(`ROM request failed with status ${response.status}`);
      if (cancelled) return;

      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas rendering is unavailable");

      const gameboy = new Gameboy();
      const runFrame = gameboy.runFrame.bind(gameboy);
      gameboy.runFrame = (time: number) => {
        if (cancelled) return;
        runFrame(time);
      };

      let drewFirstFrame = false;
      gameboyRef.current = gameboy;
      gameboy.onFrameFinished((imageData: ImageData) => {
        if (cancelled) return;
        context.putImageData(imageData, 0, 0);
        if (!drewFirstFrame) {
          drewFirstFrame = true;
          setStatus("running");
        }
      });
      gameboy.loadGame(await response.arrayBuffer());
      if (cancelled) return;
      gameboy.run();
    }

    function preventArrowScroll(event: KeyboardEvent) {
      if (event.code.startsWith("Arrow")) event.preventDefault();
    }

    document.addEventListener("keydown", preventArrowScroll);
    start().catch((error: unknown) => {
      if (!cancelled) {
        console.error(error);
        setStatus("error");
      }
    });

    return () => {
      cancelled = true;
      gameboyRef.current = null;
      document.removeEventListener("keydown", preventArrowScroll);
    };
  }, [romUrl]);

  function pressControl(control: InputControl, pressed: boolean) {
    const input = gameboyRef.current?.input;
    if (!input) return;
    // Emulator input is a mutable hardware register, not React state.
    if (control === "up") input.isPressingUp = pressed;
    if (control === "down") input.isPressingDown = pressed;
    if (control === "left") input.isPressingLeft = pressed;
    if (control === "right") input.isPressingRight = pressed;
    if (control === "a") input.isPressingA = pressed;
    if (control === "b") input.isPressingB = pressed;
    if (control === "start") input.isPressingStart = pressed;
    if (control === "select") input.isPressingSelect = pressed;
  }

  function onTouchDown(control: InputControl) {
    return (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pressControl(control, true);
    };
  }

  function onTouchUp(control: InputControl) {
    return () => pressControl(control, false);
  }

  return (
    <div className={styles.stage}>
      <div className={styles.shell}>
        <canvas ref={canvasRef} width={160} height={144} aria-label={`${title} game screen`}>
          Canvas is required to run this game.
        </canvas>
      </div>
      <p className={`${styles.status} ${styles[status]}`} role="status">
        {status === "loading" && "Loading ROM…"}
        {status === "running" && "Running"}
        {status === "error" && "Unable to start the game"}
      </p>
      <div className={styles.touch} aria-label="Touch controls">
        <div className={styles.dpad} aria-label="Direction pad">
          <button
            type="button"
            className={styles.up}
            aria-label="Up"
            disabled={status !== "running"}
            onPointerDown={onTouchDown("up")}
            onPointerUp={onTouchUp("up")}
            onPointerCancel={onTouchUp("up")}
            onLostPointerCapture={onTouchUp("up")}
          >
            ▲
          </button>
          <button
            type="button"
            className={styles.left}
            aria-label="Left"
            disabled={status !== "running"}
            onPointerDown={onTouchDown("left")}
            onPointerUp={onTouchUp("left")}
            onPointerCancel={onTouchUp("left")}
            onLostPointerCapture={onTouchUp("left")}
          >
            ◀
          </button>
          <span className={styles.dpadCenter} aria-hidden="true" />
          <button
            type="button"
            className={styles.right}
            aria-label="Right"
            disabled={status !== "running"}
            onPointerDown={onTouchDown("right")}
            onPointerUp={onTouchUp("right")}
            onPointerCancel={onTouchUp("right")}
            onLostPointerCapture={onTouchUp("right")}
          >
            ▶
          </button>
          <button
            type="button"
            className={styles.down}
            aria-label="Down"
            disabled={status !== "running"}
            onPointerDown={onTouchDown("down")}
            onPointerUp={onTouchUp("down")}
            onPointerCancel={onTouchUp("down")}
            onLostPointerCapture={onTouchUp("down")}
          >
            ▼
          </button>
        </div>
        <div className={styles.system} aria-label="System controls">
          <button
            type="button"
            aria-label="Select"
            disabled={status !== "running"}
            onPointerDown={onTouchDown("select")}
            onPointerUp={onTouchUp("select")}
            onPointerCancel={onTouchUp("select")}
            onLostPointerCapture={onTouchUp("select")}
          >
            Select
          </button>
          <button
            type="button"
            aria-label="Start"
            disabled={status !== "running"}
            onPointerDown={onTouchDown("start")}
            onPointerUp={onTouchUp("start")}
            onPointerCancel={onTouchUp("start")}
            onLostPointerCapture={onTouchUp("start")}
          >
            Start
          </button>
          <button type="button" onClick={onRestart}>
            Restart
          </button>
        </div>
        <div className={styles.actions} aria-label="Action buttons">
          <button
            type="button"
            className={styles.b}
            aria-label="B button"
            disabled={status !== "running"}
            onPointerDown={onTouchDown("b")}
            onPointerUp={onTouchUp("b")}
            onPointerCancel={onTouchUp("b")}
            onLostPointerCapture={onTouchUp("b")}
          >
            B
          </button>
          <button
            type="button"
            className={styles.a}
            aria-label="A button"
            disabled={status !== "running"}
            onPointerDown={onTouchDown("a")}
            onPointerUp={onTouchUp("a")}
            onPointerCancel={onTouchUp("a")}
            onLostPointerCapture={onTouchUp("a")}
          >
            A
          </button>
        </div>
      </div>
    </div>
  );
}
