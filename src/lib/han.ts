import jpMap from "./han-jp.json";
import zhMap from "./han-zh.json";

const TO_JP = jpMap as Record<string, string>;
const TO_ZH = zhMap as Record<string, string>;

export function toJa(text: string) {
  if (!text) return text;
  let out = "";
  for (const ch of text) out += TO_JP[ch] ?? ch;
  return out.replace(/站/g, "駅");
}

export function toZh(text: string) {
  if (!text) return text;
  let out = "";
  for (const ch of text) out += TO_ZH[ch] ?? ch;
  return out.replace(/駅/g, "站").replace(/站站/g, "站");
}

export function hanFold(text: string) {
  return toJa(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[駅站]/g, "")
    .replace(/station$/i, "")
    .replace(/[ヶケヵカがガのノ之ツっッ・\-–—'’.\s_]/g, "")
    .trim();
}
