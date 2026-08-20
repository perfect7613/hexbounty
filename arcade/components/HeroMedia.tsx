"use client";

import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function HeroMedia() {
  const reduceMotion = useSyncExternalStore(subscribe, prefersReducedMotion, () => true);

  if (reduceMotion) {
    return (
      <img alt="" className="hero-media" src="/hero-reconstruction.jpg" />
    );
  }

  return (
    <video
      aria-hidden="true"
      autoPlay
      className="hero-media"
      loop
      muted
      playsInline
      poster="/hero-reconstruction.jpg"
    >
      <source src="/hero-reconstruction.mp4" type="video/mp4" />
      <source src="/hero-gameboy.mp4" type="video/mp4" />
    </video>
  );
}
