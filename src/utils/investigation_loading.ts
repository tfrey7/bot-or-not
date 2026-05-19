// Photo-stack slideshow shown while an investigation is in flight. Each slide
// is its own absolutely-positioned <img> in the stage; on each tick we bring
// the next one to the top of the stack with a fresh random rotation and a
// short "drop into place" animation. After we cycle through every slide we
// re-place the first one on top again, so the stack keeps growing visually
// even though we only ever own SLIDES.length elements.
//
// Both the photo-rotation timer and the elapsed-time ticker self-terminate
// once the wrap element is no longer in the DOM, so a re-render of the host
// (detail pane or flyout) doesn't leak intervals.

import { bonExpectedDurationSec } from "./expected_duration.ts";

const SLIDES: ReadonlyArray<{ src: string; alt: string }> = [
  {
    src: "icons/chromes-investigating.png",
    alt: "Sherlock Chromes examining evidence under a desk lamp",
  },
  {
    src: "icons/chromes-corkboard.png",
    alt: "Sherlock Chromes studying a corkboard of pinned photos and red string",
  },
  {
    src: "icons/chromes-peephole.png",
    alt: "Sherlock Chromes peering through a peephole",
  },
  {
    src: "icons/chromes-typewriter.png",
    alt: "Sherlock Chromes typing up a case report at a desk lamp",
  },
  {
    src: "icons/chromes-magnifier-doorknob.png",
    alt: "Sherlock Chromes inspecting a brass doorknob with a magnifying glass",
  },
  {
    src: "icons/chromes-plaster-cast.png",
    alt: "Sherlock Chromes pouring plaster into a boot print in a cobblestone alley",
  },
  {
    src: "icons/chromes-microscope.png",
    alt: "Sherlock Chromes peering into a brass microscope at a glass slide",
  },
  {
    src: "icons/chromes-wiretap.png",
    alt: "Sherlock Chromes listening on headphones beside a reel-to-reel recorder",
  },
  {
    src: "icons/chromes-foggy-alley.png",
    alt: "Sherlock Chromes walking through a foggy lamplit alley",
  },
  {
    src: "icons/chromes-filing-cabinet.png",
    alt: "Sherlock Chromes pulling a folder from a filing cabinet by flashlight",
  },
  {
    src: "icons/chromes-darkroom.png",
    alt: "Sherlock Chromes lifting a developing photograph under a red darkroom safelight",
  },
];

const SLIDE_INTERVAL_MS = 3500;
const PLACE_DURATION_MS = 580;

interface SlideshowGeometry {
  minRotationDeg: number;
  maxRotationDeg: number;
  maxOffsetXPx: number;
  maxOffsetYPx: number;
  liftPx: number;
}

const FULL_GEOMETRY: SlideshowGeometry = {
  minRotationDeg: 4,
  maxRotationDeg: 14,
  maxOffsetXPx: 96,
  maxOffsetYPx: 40,
  liftPx: 28,
};

const COMPACT_GEOMETRY: SlideshowGeometry = {
  minRotationDeg: 3,
  maxRotationDeg: 10,
  maxOffsetXPx: 48,
  maxOffsetYPx: 20,
  liftPx: 18,
};

export interface InvestigationLoadingOpts {
  compact?: boolean;
  expectedDurationMs?: number | null;
}

export function bonInvestigationLoading(
  startedAt: number | null | undefined,
  { compact = false, expectedDurationMs = null }: InvestigationLoadingOpts = {}
): HTMLDivElement {
  const geometry = compact ? COMPACT_GEOMETRY : FULL_GEOMETRY;

  const wrap = document.createElement("div");
  wrap.className = "bon-investigation-loading";
  if (compact) {
    wrap.classList.add("bon-investigation-loading--compact");
  }

  const stage = document.createElement("div");
  stage.className = "bon-investigation-loading__stage";

  const photos = SLIDES.map((slide) => {
    const img = document.createElement("img");
    img.className = "bon-investigation-loading__photo";
    img.src = browser.runtime.getURL(slide.src);
    img.alt = slide.alt;
    stage.appendChild(img);
    return img;
  });

  wrap.appendChild(stage);

  const overlay = document.createElement("div");
  overlay.className = "bon-investigation-loading__overlay";
  wrap.appendChild(overlay);

  let zCounter = 0;
  let nextIdx = Math.floor(Math.random() * photos.length);
  let rotationSign: 1 | -1 = Math.random() < 0.5 ? 1 : -1;

  const placeNext = (): void => {
    const img = photos[nextIdx]!;
    zCounter += 1;
    nextIdx = (nextIdx + 1) % photos.length;

    const rotation =
      rotationSign *
      randBetween(geometry.minRotationDeg, geometry.maxRotationDeg);
    rotationSign = rotationSign === 1 ? -1 : 1;

    const offsetX = randBetween(-geometry.maxOffsetXPx, geometry.maxOffsetXPx);
    const offsetY = randBetween(-geometry.maxOffsetYPx, geometry.maxOffsetYPx);
    const settled = `translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg)`;

    img.style.zIndex = String(zCounter);
    img.style.opacity = "1";
    img.style.transform = settled;

    const startRotation = rotation - Math.sign(rotation) * 5;
    img.animate(
      [
        {
          transform: `translate(${offsetX}px, ${offsetY - geometry.liftPx}px) rotate(${startRotation}deg) scale(1.08)`,
          opacity: 0,
        },
        { transform: settled, opacity: 1 },
      ],
      { duration: PLACE_DURATION_MS, easing: "cubic-bezier(0.22, 0.7, 0.3, 1)" }
    );
  };

  placeNext();

  const timer = setInterval(() => {
    if (!stage.isConnected) {
      clearInterval(timer);
      return;
    }

    placeNext();
  }, SLIDE_INTERVAL_MS);

  const caption = document.createElement("p");
  caption.className = "bon-investigation-loading__caption";
  caption.textContent = "Investigating";
  overlay.appendChild(caption);

  if (startedAt) {
    const meta = document.createElement("p");
    meta.className = "bon-investigation-loading__meta";
    overlay.appendChild(meta);

    const writeElapsed = (): void => {
      const elapsedSec = Math.max(
        0,
        Math.round((Date.now() - startedAt) / 1000)
      );
      meta.textContent = expectedDurationMs
        ? `${elapsedSec}s / ~${bonExpectedDurationSec(expectedDurationMs)}s`
        : `${elapsedSec}s`;
    };

    writeElapsed();
    const elapsedTimer = setInterval(() => {
      if (!wrap.isConnected) {
        clearInterval(elapsedTimer);
        return;
      }

      writeElapsed();
    }, 1000);
  }

  return wrap;
}

function randBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}
