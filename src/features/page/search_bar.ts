// Header user search — typeahead over reported usernames. Selecting a
// suggestion hands the username to the page orchestrator, which activates
// the Redditors tab and selects the user in the detail pane. A query that
// matches no report but looks like a valid Reddit username gets an
// "Investigate" entry that queues a fresh investigation.

import { clientSend } from "../../client.ts";
import {
  pageSearchSuggestions,
  type PageSearchSuggestion,
} from "./search_logic.ts";

export interface PageSearchBarDeps {
  input: HTMLInputElement;
  suggestionsEl: HTMLElement;
  getUsernames(): string[];
  onNavigateToUser(username: string): void;
}

export function pageInitSearchBar(deps: PageSearchBarDeps): void {
  const { input, suggestionsEl } = deps;

  let suggestions: PageSearchSuggestion[] = [];
  let activeIndex = 0;

  const close = (): void => {
    suggestions = [];
    suggestionsEl.replaceChildren();
    suggestionsEl.hidden = true;
    input.setAttribute("aria-expanded", "false");
  };

  const settle = (username: string): void => {
    input.value = "";
    close();
    input.blur();
    deps.onNavigateToUser(username);
  };

  const showNotice = (text: string): void => {
    suggestions = [];

    const item = document.createElement("li");
    item.className = "bon-search-suggestion bon-search-suggestion--notice";
    item.textContent = text;

    suggestionsEl.replaceChildren(item);
    suggestionsEl.hidden = false;
  };

  const investigate = async (username: string): Promise<void> => {
    try {
      const response = await clientSend<{ ok?: boolean; error?: string }>({
        type: "investigate-user",
        username,
      });

      if (response?.ok === false) {
        showNotice(
          response.error === "no-api-key"
            ? "No API key — add one in Settings."
            : `Couldn't start investigation: ${response.error ?? "unknown error"}`
        );

        return;
      }

      settle(username);
    } catch (error) {
      console.error("[Bot or Not] investigate from search failed", error);
      showNotice("Couldn't start investigation.");
    }
  };

  const activate = (suggestion: PageSearchSuggestion): void => {
    if (suggestion.kind === "user") {
      settle(suggestion.username);
      return;
    }

    void investigate(suggestion.username);
  };

  const markActive = (): void => {
    suggestionsEl
      .querySelectorAll<HTMLElement>(".bon-search-suggestion")
      .forEach((item, index) => {
        item.classList.toggle(
          "bon-search-suggestion--active",
          index === activeIndex
        );
      });
  };

  const render = (): void => {
    if (suggestions.length === 0) {
      close();
      return;
    }

    const items = suggestions.map((suggestion) => {
      const item = document.createElement("li");
      item.className = "bon-search-suggestion";
      item.setAttribute("role", "option");

      const name = document.createElement("span");
      name.className = "bon-search-suggestion-name bon-pii-name";
      name.textContent = `u/${suggestion.username}`;

      if (suggestion.kind === "investigate") {
        item.classList.add("bon-search-suggestion--investigate");
        item.append("Investigate ", name);
      } else {
        item.append(name);
      }

      // mousedown fires before the input's blur would close the list —
      // prevent it so the click lands on a still-open suggestion.
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        activate(suggestion);
      });

      return item;
    });

    suggestionsEl.replaceChildren(...items);
    suggestionsEl.hidden = false;
    input.setAttribute("aria-expanded", "true");
    markActive();
  };

  const refresh = (): void => {
    suggestions = pageSearchSuggestions(input.value, deps.getUsernames());
    activeIndex = 0;
    render();
  };

  input.addEventListener("input", refresh);
  input.addEventListener("focus", refresh);
  input.addEventListener("blur", close);

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (suggestions.length === 0) {
        return;
      }

      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      activeIndex =
        (activeIndex + delta + suggestions.length) % suggestions.length;
      markActive();
      return;
    }

    if (event.key === "Enter") {
      const active = suggestions[activeIndex];
      if (!active) {
        return;
      }

      event.preventDefault();
      activate(active);
      return;
    }

    if (event.key === "Escape") {
      close();
      input.blur();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }

    event.preventDefault();
    input.focus();
    input.select();
  });
}
