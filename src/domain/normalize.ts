import { KANA_CODE_UNIT_OFFSET } from "../constants";

export function normalizeText(text: string): string {
  return text.normalize("NFKC").trim();
}

export function normalizeName(name: string): string {
  return normalizeText(name).replace(/[ぁ-ゖゝゞ]/gu, (character) =>
    String.fromCharCode(character.charCodeAt(0) + KANA_CODE_UNIT_OFFSET),
  );
}
