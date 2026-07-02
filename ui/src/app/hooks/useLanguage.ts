"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LANGUAGE_CHANGE_EVENT,
  LANGUAGE_STORAGE_KEY,
  inferBrowserLanguage,
  readStoredLanguage,
  translate,
  type CopyKey,
  type UiLanguage,
  writeStoredLanguage,
} from "@/lib/i18n";

export function useLanguage() {
  const [language, setLanguageState] = useState<UiLanguage>("zh");

  useEffect(() => {
    const initial = readStoredLanguage() || inferBrowserLanguage();
    setLanguageState(initial);
    document.documentElement.lang = initial === "zh" ? "zh-CN" : "en";

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LANGUAGE_STORAGE_KEY) return;
      if (event.newValue === "zh" || event.newValue === "en") {
        setLanguageState(event.newValue);
      }
    };
    const handleCustom = (event: Event) => {
      const detail = (event as CustomEvent<{ language?: unknown }>).detail;
      if (detail?.language === "zh" || detail?.language === "en") {
        setLanguageState(detail.language);
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(LANGUAGE_CHANGE_EVENT, handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(LANGUAGE_CHANGE_EVENT, handleCustom);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  const setLanguage = useCallback((nextLanguage: UiLanguage) => {
    setLanguageState(nextLanguage);
    writeStoredLanguage(nextLanguage);
  }, []);

  const t = useCallback(
    (key: CopyKey, params?: Record<string, string | number>) =>
      translate(language, key, params),
    [language]
  );

  return useMemo(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t]
  );
}
