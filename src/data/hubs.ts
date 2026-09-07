import { hanFold } from "@/lib/han";

export type HubNode = {
  id: string;
  name: string;
  aliases: string[];
  lng: number;
  lat: number;
  prefecture: string;
};

export const HUBS: HubNode[] = [
  { id: "tokyo", name: "東京", aliases: ["东京", "东京站", "tokyo", "tokyo station", "東京駅"], lng: 139.767, lat: 35.681, prefecture: "東京都" },
  { id: "shinagawa", name: "品川", aliases: ["shinagawa", "品川駅"], lng: 139.739, lat: 35.629, prefecture: "東京都" },
  { id: "shinjuku", name: "新宿", aliases: ["shinjuku", "新宿駅"], lng: 139.700, lat: 35.690, prefecture: "東京都" },
  { id: "shibuya", name: "渋谷", aliases: ["涩谷", "shibuya", "渋谷駅"], lng: 139.701, lat: 35.659, prefecture: "東京都" },
  { id: "ikebukuro", name: "池袋", aliases: ["ikebukuro", "池袋駅"], lng: 139.711, lat: 35.730, prefecture: "東京都" },
  { id: "ueno", name: "上野", aliases: ["ueno", "上野駅"], lng: 139.777, lat: 35.714, prefecture: "東京都" },
  { id: "akihabara", name: "秋葉原", aliases: ["秋叶原", "akihabara", "akiba"], lng: 139.773, lat: 35.698, prefecture: "東京都" },
  { id: "tokyo-shimbashi", name: "新橋", aliases: ["新桥", "shimbashi", "shinbashi"], lng: 139.758, lat: 35.666, prefecture: "東京都" },
  { id: "chiba", name: "千葉", aliases: ["千叶", "chiba", "千葉駅", "千叶站"], lng: 140.113, lat: 35.613, prefecture: "千葉県" },
  { id: "funabashi", name: "船橋", aliases: ["船桥", "funabashi"], lng: 139.984, lat: 35.702, prefecture: "千葉県" },
  { id: "kashiwa", name: "柏", aliases: ["kashiwa"], lng: 139.971, lat: 35.862, prefecture: "千葉県" },
  { id: "abiko", name: "我孫子", aliases: ["我孙子", "abiko"], lng: 140.029, lat: 35.873, prefecture: "千葉県" },
  { id: "narita", name: "成田", aliases: ["narita"], lng: 140.319, lat: 35.777, prefecture: "千葉県" },
  { id: "yokohama", name: "横浜", aliases: ["横滨", "yokohama", "横浜駅"], lng: 139.623, lat: 35.466, prefecture: "神奈川県" },
  { id: "kawasaki", name: "川崎", aliases: ["kawasaki"], lng: 139.698, lat: 35.531, prefecture: "神奈川県" },
  { id: "omiya", name: "大宮", aliases: ["大宫", "omiya", "omiya"], lng: 139.624, lat: 35.906, prefecture: "埼玉県" },
  { id: "osaka", name: "大阪", aliases: ["osaka", "大阪駅"], lng: 135.498, lat: 34.702, prefecture: "大阪府" },
  { id: "umeda", name: "梅田", aliases: ["umeda"], lng: 135.498, lat: 34.705, prefecture: "大阪府" },
  { id: "namba", name: "難波", aliases: ["难波", "namba", "nanba"], lng: 135.502, lat: 34.666, prefecture: "大阪府" },
  { id: "shin-osaka", name: "新大阪", aliases: ["新大阪", "shin-osaka", "shinosaka"], lng: 135.500, lat: 34.733, prefecture: "大阪府" },
  { id: "kyoto", name: "京都", aliases: ["kyoto", "京都駅"], lng: 135.759, lat: 34.986, prefecture: "京都府" },
  { id: "nagoya", name: "名古屋", aliases: ["nagoya", "名古屋駅"], lng: 136.882, lat: 35.171, prefecture: "愛知県" },
  { id: "hakata", name: "博多", aliases: ["hakata", "福冈", "福岡"], lng: 130.421, lat: 33.590, prefecture: "福岡県" },
  { id: "sapporo", name: "札幌", aliases: ["sapporo"], lng: 141.351, lat: 43.068, prefecture: "北海道" },
  { id: "sendai", name: "仙台", aliases: ["sendai"], lng: 140.882, lat: 38.260, prefecture: "宮城県" },
  { id: "hiroshima", name: "広島", aliases: ["广岛", "hiroshima"], lng: 132.459, lat: 34.398, prefecture: "広島県" },
  { id: "kobe", name: "神戸", aliases: ["神户", "kobe"], lng: 135.195, lat: 34.679, prefecture: "兵庫県" },
];

export function hubNameFor(query: string): string | null {
  const raw = query.trim().normalize("NFKC");
  if (!raw) return null;
  const q = hanFold(raw);
  for (const hub of HUBS) {
    if (hanFold(hub.name) === q) return hub.name;
    if (hub.aliases.some((a) => hanFold(a) === q)) return hub.name;
  }
  return null;
}
