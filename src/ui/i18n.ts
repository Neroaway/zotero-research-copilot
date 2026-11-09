import type { Language } from "../storage/settings.ts";

export function tr(language: Language, en: string, zh: string): string {
  return language === "zh" ? zh : en;
}
