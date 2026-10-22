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
 * the signed-in user and the page, so the user can get their text back if it
 * was lost anyway (for example after choosing to leave, or a crash). Nothing
 * is sent anywhere. The copy:
 *   - is never kept for legal pages (unapproved legal wording stays only in
 *     the open editor and the database);
 *   - expires 8 hours after the last edit;
 *   - is removed when the draft is saved or the user discards it, when the
 *     user confirms Sign out, and when the tab is closed;
 *   - is only ever offered to the user who wrote it.
 * Whenever a Website screen opens, copies that break these rules (another
 * user's, expired, legal, or unreadable) are deleted from the tab.
 */
export type DraftStash<T> = { base: number; savedAt: string; kind: string; draft: T };

export const DRAFT_STASH_PREFIX = "roicians.website.unsaved.";
export const DRAFT_STASH_MAX_AGE_MS = 8 * 60 * 60 * 1000;
// A copy dated in the future (beyond small clock changes) is not trusted.
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Whether unsaved content of this page type may be kept in the browser tab. */
export function keepsRecoveryCopy(kind: string): boolean {
  return kind !== "legal";
}

export function draftStashKey(userId: string, documentId: string): string {
  return `${DRAFT_STASH_PREFIX}${userId}.${documentId}`;
}

function stashKeyOwner(key: string): string | null {
  if (!key.startsWith(DRAFT_STASH_PREFIX)) return null;
  const parts = key.slice(DRAFT_STASH_PREFIX.length).split(".");
  return parts.length === 2 && parts[0] && parts[1] ? parts[0] : null;
}

function stashKeysInTab(): string[] {
  try {
    const storage = window.sessionStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(DRAFT_STASH_PREFIX)) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

export function readStash(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStash<T>(key: string, stash: DraftStash<T>): void {
  if (!keepsRecoveryCopy(stash.kind)) return;
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

/**
 * Reads a stored copy. Returns null for anything that must not be offered:
 * unreadable, missing its page type, a legal page, or (when `now` is given)
 * expired or dated in the future.
 */
export function parseStash<T>(raw: string | null, now?: number): DraftStash<T> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as DraftStash<T>;
    if (typeof value?.base !== "number" || typeof value?.savedAt !== "string")
      return null;
    if (typeof value.kind !== "string" || !keepsRecoveryCopy(value.kind)) return null;
    if (!value.draft || typeof value.draft !== "object") return null;
    if (now !== undefined) {
      const savedAt = Date.parse(value.savedAt);
      if (!Number.isFinite(savedAt)) return null;
      if (now - savedAt > DRAFT_STASH_MAX_AGE_MS) return null;
      if (savedAt - now > FUTURE_TOLERANCE_MS) return null;
    }
    return value;
  } catch {
    return null;
  }
}

// The usable copy as it was when the editor opened (not the copy this editor
// writes afterwards).
const openedWith = new Map<string, string | null>();

export function stashWhenOpened(key: string): string | null {
  if (!openedWith.has(key)) {
    const raw = readStash(key);
    openedWith.set(key, parseStash(raw, Date.now()) ? raw : null);
  }
  return openedWith.get(key) ?? null;
}

export function forgetStashWhenOpened(key: string): void {
  openedWith.delete(key);
}

/**
 * Deletes every copy in this tab that this user may not be offered: other
 * users' copies, expired ones, legal pages and anything unreadable.
 */
export function sweepStashes(ownerId: string, now: number = Date.now()): void {
  for (const key of stashKeysInTab()) {
    const usable = stashKeyOwner(key) === ownerId && parseStash(readStash(key), now);
    if (!usable) removeStash(key);
  }
}

/** Deletes all of this user's copies in this tab (used on Sign out). */
export function clearUserStashes(ownerId: string): void {
  for (const key of stashKeysInTab()) {
    if (stashKeyOwner(key) === ownerId) removeStash(key);
  }
  for (const key of [...openedWith.keys()]) {
    if (stashKeyOwner(key) === ownerId) openedWith.delete(key);
  }
}

/**
 * Whether a form submission is the Admin header's Sign out. The shared
 * logout button is recognised by its label, so it needs no change; a test
 * renders the real button to keep the two in step.
 */
export function isSignOutSubmit(event: Event): boolean {
  const form = event.target;
  if (typeof HTMLFormElement === "undefined" || !(form instanceof HTMLFormElement))
    return false;
  const submitter =
    (event as SubmitEvent).submitter ??
    form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
  const label =
    submitter instanceof HTMLInputElement ? submitter.value : submitter?.textContent;
  return /^\s*sign out\s*$/i.test(label ?? "");
}

/**
 * Keeps this tab's recovery copies tidy while a Website screen is open:
 * removes copies the user may not be offered when the screen opens, and
 * removes all of the user's copies when they confirm Sign out.
 *
 * The Sign out listener runs in the bubble phase, after the unsaved-changes
 * question (capture phase). If the user answers Cancel, that question stops
 * the submission before it gets here, so nothing is cleared.
 */
export function useWebsiteDraftCopyCleanup(
  ownerId: string | undefined,
  onSignOut?: () => void,
): void {
  const onSignOutRef = useRef(onSignOut);
  useEffect(() => {
    onSignOutRef.current = onSignOut;
  }, [onSignOut]);

  useEffect(() => {
    if (!ownerId) return;
    sweepStashes(ownerId);
    const onSubmit = (event: Event) => {
      if (!isSignOutSubmit(event)) return;
      onSignOutRef.current?.();
      clearUserStashes(ownerId);
    };
    window.addEventListener("submit", onSubmit);
    return () => window.removeEventListener("submit", onSubmit);
  }, [ownerId]);
}

/** Mounted on the Website screens other than the editor. Renders nothing. */
export function WebsiteDraftCopyCleanup({ ownerId }: { ownerId: string }) {
  useWebsiteDraftCopyCleanup(ownerId);
  return null;
}
