export type PeakShape = "fuji" | "spear" | "saw" | "ridge" | "crater" | "caldera" | "forest";

export type Peak = {
  id: string;
  n: string;
  nZh: string;
  nEn: string;
  lng: number;
  lat: number;
  h: number;
  shape: PeakShape;
  width: number;
  lean: number;
  area: string;
  areaZh: string;
  areaEn: string;
  photos: string[];
};

function pic(path: string) {
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}`;
}

/** Fuji first, then representative peaks across Japan. Heights in meters. */
export const PEAKS: Peak[] = [
  { id: "fuji", n: "富士山", nZh: "富士山", nEn: "Mount Fuji", lng: 138.7274, lat: 35.3606, h: 3776, shape: "fuji", width: 1, lean: 0.08, area: "山梨・静岡", areaZh: "山梨・静冈", areaEn: "Yamanashi · Shizuoka", photos: [pic("5/55/Mt.Fuji_from_Mierula.jpg/960px-Mt.Fuji_from_Mierula.jpg")] },
  { id: "okuhotaka", n: "奥穂高岳", nZh: "奥穗高岳", nEn: "Mount Okuhotaka", lng: 137.6478, lat: 36.2892, h: 3190, shape: "saw", width: 0.92, lean: 0, area: "長野・岐阜", areaZh: "长野・岐阜", areaEn: "Nagano · Gifu", photos: [pic("7/72/Mt.Hotaka_from_Mt.Otenshodake_01.jpg/960px-Mt.Hotaka_from_Mt.Otenshodake_01.jpg")] },
  { id: "yari", n: "槍ヶ岳", nZh: "枪岳", nEn: "Mount Yari", lng: 137.6473, lat: 36.3422, h: 3180, shape: "spear", width: 0.42, lean: -0.04, area: "長野・岐阜", areaZh: "长野・岐阜", areaEn: "Nagano · Gifu", photos: [pic("8/8e/Mt.Yarigatake_from_Enzansou.jpg/960px-Mt.Yarigatake_from_Enzansou.jpg")] },
  { id: "ontake", n: "御嶽山", nZh: "御岳山", nEn: "Mount Ontake", lng: 137.4806, lat: 35.8928, h: 3067, shape: "fuji", width: 1.08, lean: -0.06, area: "長野・岐阜", areaZh: "长野・岐阜", areaEn: "Nagano · Gifu", photos: [pic("f/f4/Ontake-air.jpg/960px-Ontake-air.jpg")] },
  { id: "tateyama", n: "立山", nZh: "立山", nEn: "Mount Tate", lng: 137.6175, lat: 36.5758, h: 3015, shape: "ridge", width: 1.18, lean: 0.1, area: "富山", areaZh: "富山", areaEn: "Toyama", photos: [pic("c/cf/Mount_Tate_viewed_from_Midorigaike.jpg/960px-Mount_Tate_viewed_from_Midorigaike.jpg")] },
  { id: "shirouma", n: "白馬岳", nZh: "白马岳", nEn: "Mount Shirouma", lng: 137.7586, lat: 36.7586, h: 2932, shape: "ridge", width: 1.12, lean: -0.12, area: "長野・富山", areaZh: "长野・富山", areaEn: "Nagano · Toyama", photos: [pic("3/3c/Shiroumadake_from_maruyama_26_2000_7_30.jpg/960px-Shiroumadake_from_maruyama_26_2000_7_30.jpg")] },
  { id: "akadake", n: "赤岳", nZh: "赤岳", nEn: "Mount Aka", lng: 138.2403, lat: 35.9708, h: 2899, shape: "saw", width: 0.88, lean: 0.06, area: "長野・山梨", areaZh: "长野・山梨", areaEn: "Nagano · Yamanashi", photos: [pic("a/ad/Mt.Akadake_from_Mt.Yokodake_08.jpg/960px-Mt.Akadake_from_Mt.Yokodake_08.jpg")] },
  { id: "hakusan", n: "白山", nZh: "白山", nEn: "Mount Haku", lng: 136.7714, lat: 36.155, h: 2702, shape: "ridge", width: 1.22, lean: 0, area: "石川・岐阜", areaZh: "石川・岐阜", areaEn: "Ishikawa · Gifu", photos: [pic("e/eb/Mount_Haku_from_Onanjimine_2011-07-17.jpg/960px-Mount_Haku_from_Onanjimine_2011-07-17.jpg")] },
  { id: "asama", n: "浅間山", nZh: "浅间山", nEn: "Mount Asama", lng: 138.5231, lat: 36.4064, h: 2568, shape: "crater", width: 0.86, lean: 0, area: "長野・群馬", areaZh: "长野・群马", areaEn: "Nagano · Gunma", photos: [pic("3/3d/AsamaYamaS.jpg/960px-AsamaYamaS.jpg")] },
  { id: "asahidake", n: "旭岳", nZh: "旭岳", nEn: "Mount Asahi", lng: 142.8542, lat: 43.6639, h: 2291, shape: "fuji", width: 0.9, lean: 0.04, area: "北海道", areaZh: "北海道", areaEn: "Hokkaido", photos: [pic("b/b0/140724_Asahi-dake_Hokkaido_Japan01s3.jpg/960px-140724_Asahi-dake_Hokkaido_Japan01s3.jpg")] },
  { id: "chokai", n: "鳥海山", nZh: "鸟海山", nEn: "Mount Chokai", lng: 140.0486, lat: 39.0992, h: 2236, shape: "fuji", width: 0.94, lean: -0.1, area: "山形・秋田", areaZh: "山形・秋田", areaEn: "Yamagata · Akita", photos: [pic("2/24/Mount_Ch%C5%8Dkai_%282017-05-19%29_-_Flickr.jpg/960px-Mount_Ch%C5%8Dkai_%282017-05-19%29_-_Flickr.jpg")] },
  { id: "iwate", n: "岩手山", nZh: "岩手山", nEn: "Mount Iwate", lng: 140.9197, lat: 39.8528, h: 2038, shape: "fuji", width: 0.88, lean: 0.12, area: "岩手", areaZh: "岩手", areaEn: "Iwate", photos: [pic("0/07/Mt._Iwate_and_Morioka.jpg/960px-Mt._Iwate_and_Morioka.jpg")] },
  { id: "ishizuchi", n: "石鎚山", nZh: "石锤山", nEn: "Mount Ishizuchi", lng: 133.185, lat: 33.7678, h: 1982, shape: "saw", width: 0.78, lean: 0.08, area: "愛媛", areaZh: "爱媛", areaEn: "Ehime", photos: [pic("7/71/Isidutisan20220226_1.jpg/960px-Isidutisan20220226_1.jpg")] },
  { id: "miyanoura", n: "宮之浦岳", nZh: "宫之浦岳", nEn: "Mount Miyanoura", lng: 130.5036, lat: 30.3361, h: 1936, shape: "forest", width: 1.05, lean: 0, area: "鹿児島", areaZh: "鹿儿岛", areaEn: "Kagoshima", photos: [pic("8/80/Mount_Miyanoura_20071113_%28B%29_-_Flickr.jpg/960px-Mount_Miyanoura_20071113_%28B%29_-_Flickr.jpg")] },
  { id: "yotei", n: "羊蹄山", nZh: "羊蹄山", nEn: "Mount Yotei", lng: 140.8114, lat: 42.8264, h: 1898, shape: "fuji", width: 0.7, lean: 0, area: "北海道", areaZh: "北海道", areaEn: "Hokkaido", photos: [pic("c/c7/Yotei-zan-from-hirafu.jpg/960px-Yotei-zan-from-hirafu.jpg")] },
  { id: "bandai", n: "磐梯山", nZh: "盘梯山", nEn: "Mount Bandai", lng: 140.0722, lat: 37.6008, h: 1816, shape: "caldera", width: 1.28, lean: -0.16, area: "福島", areaZh: "福岛", areaEn: "Fukushima", photos: [pic("6/62/Mt._Bandaisan_0811.JPG/960px-Mt._Bandaisan_0811.JPG")] },
  { id: "daisen", n: "大山", nZh: "大山", nEn: "Mount Daisen", lng: 133.5461, lat: 35.3711, h: 1729, shape: "fuji", width: 0.96, lean: 0.05, area: "鳥取", areaZh: "鸟取", areaEn: "Tottori", photos: [pic("a/a9/Daisen_%28mountain%29_in_2012.JPG/960px-Daisen_%28mountain%29_in_2012.JPG")] },
  { id: "rishiri", n: "利尻山", nZh: "利尻山", nEn: "Mount Rishiri", lng: 141.2417, lat: 45.1786, h: 1721, shape: "fuji", width: 0.68, lean: -0.05, area: "北海道", areaZh: "北海道", areaEn: "Hokkaido", photos: [pic("6/6f/Mt_Rishiri%282004%29.jpg/960px-Mt_Rishiri%282004%29.jpg")] },
  { id: "iwaki", n: "岩木山", nZh: "岩木山", nEn: "Mount Iwaki", lng: 140.3064, lat: 40.6558, h: 1625, shape: "fuji", width: 0.74, lean: 0.02, area: "青森", areaZh: "青森", areaEn: "Aomori", photos: [pic("c/cf/Iwakisan_01.jpg/960px-Iwakisan_01.jpg")] },
  { id: "aso", n: "阿蘇山", nZh: "阿苏山", nEn: "Mount Aso", lng: 131.1058, lat: 32.8842, h: 1592, shape: "caldera", width: 1.7, lean: 0, area: "熊本", areaZh: "熊本", areaEn: "Kumamoto", photos: [pic("a/a1/20140516%E9%98%BF%E8%98%87%E5%B1%B1%E5%BA%83%E5%9F%9F.jpg/960px-20140516%E9%98%BF%E8%98%87%E5%B1%B1%E5%BA%83%E5%9F%9F.jpg")] },
  { id: "sakurajima", n: "桜島", nZh: "樱岛", nEn: "Sakurajima", lng: 130.6572, lat: 31.585, h: 1117, shape: "crater", width: 0.82, lean: 0.1, area: "鹿児島", areaZh: "鹿儿岛", areaEn: "Kagoshima", photos: [pic("5/5c/Sakurajima55.jpg/960px-Sakurajima55.jpg")] },
  { id: "kaimon", n: "開聞岳", nZh: "开闻岳", nEn: "Mount Kaimon", lng: 130.5283, lat: 31.18, h: 924, shape: "fuji", width: 0.52, lean: 0, area: "鹿児島", areaZh: "鹿儿岛", areaEn: "Kagoshima", photos: [pic("b/b1/Kaimondake_2005_3_19.jpg/960px-Kaimondake_2005_3_19.jpg")] },
];

export const FUJI_H = 3776;
export const PEAK_FOCUS_ZOOM = 10.7;

export function peakLabel(peak: Peak, lang: "ja" | "zh" | "en") {
  if (lang === "zh") return peak.nZh;
  if (lang === "en") return peak.nEn;
  return peak.n;
}

export function peakArea(peak: Peak, lang: "ja" | "zh" | "en") {
  if (lang === "zh") return peak.areaZh;
  if (lang === "en") return peak.areaEn;
  return peak.area;
}
