export type Stay = {
  id: string;
  name: string;
  nameZh: string;
  nameEn: string;
  address: string;
  addressZh: string;
  addressEn: string;
  regionJa: string;
  regionZh: string;
  regionEn: string;
  kindJa: string;
  kindZh: string;
  kindEn: string;
  lng: number;
  lat: number;
  url: string;
  phone?: string;
  photos: string[];
  video?: string;
  lineUrl?: string;
};

export const CHIBA_VIEW = { lng: 140.22, lat: 35.5, zoom: 8.12 };

export const STAYS: Stay[] = [
  {
    id: "meishifu-inzai",
    name: "中国四川料理 美食府",
    nameZh: "中国四川料理・美食府",
    nameEn: "Meishifu Sichuan Cuisine",
    address: "〒270-1327 千葉県印西市大森2442-1",
    addressZh: "〒270-1327 千叶县印西市大森2442-1",
    addressEn: "2442-1 Omori, Inzai, Chiba 270-1327",
    regionJa: "千葉",
    regionZh: "千叶",
    regionEn: "Chiba",
    kindJa: "飲食",
    kindZh: "餐饮",
    kindEn: "Dining",
    lng: 140.1444,
    lat: 35.8353,
    url: "https://tabelog.com/chiba/A1203/A120304/12035148/",
    phone: "0476-85-7396",
    photos: [
      "/stays/meishifu-shop.jpg",
      "/stays/meishifu-night.jpg",
      "/stays/meishifu-inside.jpg",
      "/stays/meishifu-food.jpg",
      "/stays/meishifu-food2.jpg",
    ],
  },
];

export function stayLabel(stay: Stay, lang: "ja" | "zh" | "en") {
  if (lang === "zh") return stay.nameZh;
  if (lang === "en") return stay.nameEn;
  return stay.name;
}

export function stayAddress(stay: Stay, lang: "ja" | "zh" | "en") {
  if (lang === "zh") return stay.addressZh;
  if (lang === "en") return stay.addressEn;
  return stay.address;
}

export function stayRegion(stay: Stay, lang: "ja" | "zh" | "en") {
  if (lang === "zh") return stay.regionZh;
  if (lang === "en") return stay.regionEn;
  return stay.regionJa;
}

export function stayKind(stay: Stay, lang: "ja" | "zh" | "en") {
  if (lang === "zh") return stay.kindZh;
  if (lang === "en") return stay.kindEn;
  return stay.kindJa;
}
