"use client";

import { useEffect, useState } from "react";

const INTRO_DURATION_MS = 1850;
const REDUCED_MOTION_DURATION_MS = 280;
const INTRO_COMPLETE_EVENT = "internagents.intro.complete";

type IntroWindow = Window & {
  __internagentsIntroComplete?: boolean;
};

function markIntroComplete() {
  const introWindow = window as IntroWindow;
  introWindow.__internagentsIntroComplete = true;
  window.dispatchEvent(new Event(INTRO_COMPLETE_EVENT));
}

export function WaterRippleIntro() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const navigationEntry = performance.getEntriesByType(
      "navigation"
    )[0] as PerformanceNavigationTiming | undefined;
    if (navigationEntry?.type === "reload") {
      markIntroComplete();
      return;
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    (window as IntroWindow).__internagentsIntroComplete = false;
    setVisible(true);
    const timeout = window.setTimeout(
      () => {
        setVisible(false);
        markIntroComplete();
      },
      prefersReducedMotion ? REDUCED_MOTION_DURATION_MS : INTRO_DURATION_MS
    );

    return () => window.clearTimeout(timeout);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div
      className="water-ripple-intro"
      data-water-ripple-intro="true"
      aria-hidden="true"
    >
      <span className="water-ripple-intro__field" />
      <span className="water-ripple-intro__caustics" />
      <span className="water-ripple-intro__lens" />
      <span className="water-ripple-intro__ring water-ripple-intro__ring--one" />
      <span className="water-ripple-intro__ring water-ripple-intro__ring--two" />
      <span className="water-ripple-intro__ring water-ripple-intro__ring--three" />
      <span className="water-ripple-intro__ring water-ripple-intro__ring--four" />
      <span className="water-ripple-intro__flash" />
      <span className="water-ripple-intro__brand">
        <span className="water-ripple-intro__title">InternAgents</span>
        <span className="water-ripple-intro__subtitle">
          上海人工智能实验室
        </span>
      </span>
    </div>
  );
}
