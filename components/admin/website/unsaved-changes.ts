"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Phase 22B-1: protects unsaved editor content from being discarded by
 * navigation.
 *
 * `beforeunload` alone only covers full page loads (closing the tab, reloading,
 * typing a URL). Next.js links, the sidebar, the header's Sign out form and the
 * browser's Back/Forward buttons navigate inside the app WITHOUT unloading the
 * page, so they would silently discard the editor's state. While there are
 * unsaved changes this guard therefore also:
 *   - asks before following a same-tab link to another page of this site
 *     (links opening a new tab, downloads and modified clicks are left alone);
 *   - asks before a form outside the editor is submitted (for example Sign out);
 *   - asks before Back/Forward leaves the editor, and stays if the user says
 *     no. This uses the browser's Navigation API `navigate` event, which runs
 *     before Next.js reacts to Back/Forward. (A `popstate` listener cannot do
 *     it: Next.js's own listener runs first and the editor is already gone.)
 *     Browsers without that API, or a browser that refuses to let the page
 *     cancel (for example a second Back with no click or key press in
 *     between), leave the page without asking; the per-tab safety copy below
 *     then lets the user restore the text when they come back.
 * The click and submit listeners are attached to `window` in the capture
 * phase, so they run before Next.js handles the click, and shared LMS
 * components need no change.
 */

export const UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes on this page. Leave without saving them?";

type ClickLike = Pick<
  MouseEvent,
  "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented"
>;

/** Whether following this link would replace the current page in this tab. */
export function isSameTabNavigation(
  event: ClickLike,
  anchor: HTMLAnchorElement,
  current: URL,
): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  const raw = anchor.getAttribute("href");
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw, current.href);
  } catch {
    return false;
  }
  // Another site loads a new document, which `beforeunload` already covers.
  if (url.origin !== current.origin) return false;
  // The same page (for example a #section link) keeps the editor.
  if (url.pathname === current.pathname && url.search === current.search) return false;
  return true;
}

/** The parts of the Navigation API `navigate` event this guard uses. */
type NavigateEventLike = Event & { navigationType?: string };

function navigationApi(): EventTarget | null {
  const nav = (window as Window & { navigation?: unknown }).navigation;
  return nav && typeof (nav as EventTarget).addEventListener === "function"
    ? (nav as EventTarget)
    : null;
}

export function useUnsavedChangesGuard(
  dirty: boolean,
  containerRef: RefObject<HTMLElement | null>,
  confirmLeave: () => boolean = () => window.confirm(UNSAVED_CHANGES_MESSAGE),
): void {
  const dirtyRef = useRef(dirty);
  const confirmRef = useRef(confirmLeave);

  useEffect(() => {
    dirtyRef.current = dirty;
    confirmRef.current = confirmLeave;
  }, [dirty, confirmLeave]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
    };

    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (!isSameTabNavigation(event, anchor, new URL(window.location.href))) return;
      if (confirmRef.current()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onSubmit = (event: SubmitEvent) => {
      if (!dirtyRef.current) return;
      const form = event.target as Node | null;
      if (form && containerRef.current?.contains(form)) return;
      if (confirmRef.current()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    // Back/Forward within the app. Links and forms are handled above, and
    // reloads or other sites by `beforeunload`.
    const onNavigate = (event: Event) => {
      if (!dirtyRef.current) return;
      if ((event as NavigateEventLike).navigationType !== "traverse") return;
      if (!event.cancelable) return;
      if (confirmRef.current()) return;
      event.preventDefault();
    };

    const navigation = navigationApi();
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, true);
    window.addEventListener("submit", onSubmit, true);
    navigation?.addEventListener("navigate", onNavigate);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("submit", onSubmit, true);
      navigation?.removeEventListener("navigate", onNavigate);
    };
  }, [containerRef]);
}

// ---------------------------------------------------------------------------
// Unsaved-draft safety copy (this browser tab only)

/**
 * A copy of unsaved editor content kept in this tab's sessionStorage, keyed to
 * the signed-in user and the page. It lets the user get their text back if it
 * was lost anyway (for example after choosing to leave, or a crash). It is
 * removed when the draft is saved or the user discards it, and disappears when
 * the tab is closed. Nothing is sent anywhere.
 */
export type DraftStash<T> = { base: number; savedAt: string; draft: T };

export function draftStashKey(userId: string, documentId: string): string {
  return `roicians.website.unsaved.${userId}.${documentId}`;
}

export function readStash(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStash<T>(key: string, stash: DraftStash<T>): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(stash));
  } catch {
    // Storage full or unavailable: the confirmation prompts still protect the text.
  }
}

export function removeStash(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function parseStash<T>(raw: string | null): DraftStash<T> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as DraftStash<T>;
    if (typeof value?.base !== "number" || typeof value?.savedAt !== "string")
      return null;
    if (!value.draft || typeof value.draft !== "object") return null;
    return value;
  } catch {
    return null;
  }
}

// The stash as it was when the editor opened (not the copy this editor writes).
const openedWith = new Map<string, string | null>();

export function stashWhenOpened(key: string): string | null {
  if (!openedWith.has(key)) openedWith.set(key, readStash(key));
  return openedWith.get(key) ?? null;
}

export function forgetStashWhenOpened(key: string): void {
  openedWith.delete(key);
}
