// Masthead Easter egg: clicking the Sherlock Chromes mascot toggles a
// late-night jazz loop. While playing, the mascot swaps to a portrait of
// him on saxophone so the affordance is self-evident.

const MASCOT_DEFAULT_SRC = "../icons/chromes.png";
const MASCOT_SAX_SRC = "../icons/chromes-sax.png";
const JAZZ_AUDIO_URL =
  "https://raw.githubusercontent.com/tfrey7/bot-or-not/main/jazz.ogg";

export function bonReportsInitJazzLogo(): void {
  const button = document.getElementById("bon-mascot-btn") as HTMLButtonElement;
  const image = document.getElementById("bon-mascot-img") as HTMLImageElement;

  const audio = new Audio(JAZZ_AUDIO_URL);
  audio.loop = true;
  audio.preload = "none";

  const setPlayingUi = (playing: boolean): void => {
    image.src = playing ? MASCOT_SAX_SRC : MASCOT_DEFAULT_SRC;
    button.classList.toggle("bon-header-mascot-btn--playing", playing);
    button.setAttribute("aria-pressed", playing ? "true" : "false");
    button.setAttribute(
      "aria-label",
      playing ? "Stop late-night jazz" : "Play late-night jazz"
    );
  };

  audio.addEventListener("ended", () => setPlayingUi(false));
  audio.addEventListener("pause", () => setPlayingUi(false));
  audio.addEventListener("playing", () => setPlayingUi(true));

  button.addEventListener("click", async () => {
    if (!audio.paused) {
      audio.pause();
      return;
    }

    try {
      await audio.play();
    } catch (error) {
      console.error("[Bot or Not] jazz playback failed", error);
    }
  });
}
