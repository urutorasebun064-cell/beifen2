import type { LineRuntime } from "@/lib/rail/types";

export type JrOp = { headway: number; speed: number; offset: number; minHw: number; first?: number; last?: number };

const SHINK: Record<string, JrOp> = {
  東海道新幹線: { headway: 4, speed: 220, offset: 0, minHw: 3 },
  山陽新幹線: { headway: 8, speed: 230, offset: 2, minHw: 5 },
  東北新幹線: { headway: 8, speed: 210, offset: 1, minHw: 5 },
  上越新幹線: { headway: 20, speed: 200, offset: 4, minHw: 12 },
  北陸新幹線: { headway: 20, speed: 200, offset: 6, minHw: 12 },
  北海道新幹線: { headway: 30, speed: 180, offset: 8, minHw: 20 },
  九州新幹線: { headway: 15, speed: 210, offset: 3, minHw: 10 },
  西九州新幹線: { headway: 20, speed: 180, offset: 5, minHw: 15 },
  山形新幹線: { headway: 30, speed: 110, offset: 7, minHw: 20 },
  秋田新幹線: { headway: 30, speed: 120, offset: 11, minHw: 20 },
};

const JR: [string, JrOp][] = [
  ["山手", { headway: 4, speed: 35, offset: 0, minHw: 2.5 }],
  ["大阪環状", { headway: 4, speed: 40, offset: 1, minHw: 3 }],
  ["京浜東北", { headway: 4, speed: 52, offset: 2, minHw: 2.5 }],
  ["根岸", { headway: 5, speed: 50, offset: 2, minHw: 3 }],
  ["中央線快速", { headway: 5, speed: 58, offset: 1, minHw: 3 }],
  ["中央線", { headway: 5, speed: 55, offset: 1, minHw: 3 }],
  ["総武線快速", { headway: 8, speed: 70, offset: 3, minHw: 5 }],
  ["総武線", { headway: 5, speed: 45, offset: 2, minHw: 3 }],
  ["総武本線", { headway: 20, speed: 65, offset: 4, minHw: 12 }],
  ["埼京", { headway: 6, speed: 60, offset: 3, minHw: 4 }],
  ["湘南新宿", { headway: 10, speed: 75, offset: 4, minHw: 6 }],
  ["上野東京", { headway: 6, speed: 70, offset: 1, minHw: 4 }],
  ["横須賀", { headway: 10, speed: 70, offset: 5, minHw: 6 }],
  ["京葉", { headway: 8, speed: 70, offset: 2, minHw: 5 }],
  ["武蔵野", { headway: 8, speed: 60, offset: 4, minHw: 6 }],
  ["南武支線", { headway: 15, speed: 45, offset: 7, minHw: 10 }],
  ["南武", { headway: 6, speed: 50, offset: 1, minHw: 4 }],
  ["横浜", { headway: 7, speed: 52, offset: 3, minHw: 4 }],
  ["常磐線快速", { headway: 8, speed: 70, offset: 2, minHw: 5 }],
  ["常磐線各駅停車", { headway: 6, speed: 42, offset: 1, minHw: 4 }],
  ["常磐", { headway: 15, speed: 75, offset: 6, minHw: 10 }],
  ["東海道本線", { headway: 10, speed: 85, offset: 0, minHw: 6 }],
  ["京都", { headway: 5, speed: 80, offset: 1, minHw: 3 }],
  ["神戸", { headway: 5, speed: 80, offset: 2, minHw: 3 }],
  ["琵琶湖", { headway: 6, speed: 85, offset: 3, minHw: 4 }],
  ["東西線", { headway: 8, speed: 50, offset: 4, minHw: 5 }],
  ["阪和", { headway: 8, speed: 70, offset: 2, minHw: 5 }],
  ["大和路線", { headway: 10, speed: 65, offset: 5, minHw: 6 }],
  ["桜島", { headway: 10, speed: 40, offset: 6, minHw: 8 }],
  ["関西空港", { headway: 15, speed: 80, offset: 7, minHw: 10 }],
  ["高崎", { headway: 10, speed: 80, offset: 4, minHw: 6 }],
  ["宇都宮", { headway: 10, speed: 80, offset: 5, minHw: 6 }],
  ["川越", { headway: 15, speed: 55, offset: 8, minHw: 10 }],
  ["青梅", { headway: 12, speed: 55, offset: 6, minHw: 8 }],
  ["五日市", { headway: 20, speed: 50, offset: 9, minHw: 12 }],
  ["八高", { headway: 30, speed: 55, offset: 11, minHw: 20 }],
  ["相模", { headway: 20, speed: 50, offset: 8, minHw: 12 }],
  ["鶴見", { headway: 12, speed: 40, offset: 3, minHw: 8 }],
  ["外房", { headway: 15, speed: 70, offset: 7, minHw: 10 }],
  ["内房", { headway: 20, speed: 70, offset: 9, minHw: 12 }],
  ["成田線我孫子", { headway: 20, speed: 55, offset: 10, minHw: 12 }],
  ["成田", { headway: 15, speed: 65, offset: 6, minHw: 10 }],
  ["久留里", { headway: 60, speed: 45, offset: 13, minHw: 40 }],
  ["小海", { headway: 60, speed: 50, offset: 17, minHw: 40 }],
  ["烏山", { headway: 60, speed: 50, offset: 19, minHw: 40 }],
  ["日光線", { headway: 40, speed: 55, offset: 14, minHw: 25 }],
  ["水郡", { headway: 60, speed: 55, offset: 21, minHw: 40 }],
  ["水戸", { headway: 30, speed: 60, offset: 12, minHw: 20 }],
  ["吾妻", { headway: 40, speed: 55, offset: 16, minHw: 25 }],
  ["両毛", { headway: 30, speed: 60, offset: 8, minHw: 20 }],
  ["伊東", { headway: 20, speed: 55, offset: 11, minHw: 12 }],
  ["片町", { headway: 10, speed: 60, offset: 4, minHw: 6 }],
  ["福知山", { headway: 15, speed: 70, offset: 7, minHw: 10 }],
  ["湖西", { headway: 20, speed: 80, offset: 9, minHw: 12 }],
  ["仙石", { headway: 12, speed: 55, offset: 5, minHw: 8 }],
  ["仙山", { headway: 30, speed: 55, offset: 13, minHw: 20 }],
  ["越後", { headway: 30, speed: 55, offset: 15, minHw: 20 }],
  ["白新", { headway: 20, speed: 60, offset: 6, minHw: 12 }],
  ["信越", { headway: 30, speed: 65, offset: 8, minHw: 20 }],
  ["羽越", { headway: 40, speed: 70, offset: 18, minHw: 25 }],
  ["奥羽", { headway: 40, speed: 70, offset: 20, minHw: 25 }],
  ["東北本線", { headway: 20, speed: 75, offset: 4, minHw: 12 }],
  ["中央本線", { headway: 20, speed: 70, offset: 7, minHw: 12 }],
  ["山陽本線", { headway: 15, speed: 80, offset: 3, minHw: 8 }],
  ["鹿児島本線", { headway: 15, speed: 75, offset: 5, minHw: 8 }],
  ["函館本線", { headway: 20, speed: 70, offset: 9, minHw: 12 }],
];

export function operationOf(line: Pick<LineRuntime, "name" | "kind" | "headway" | "speed">): Required<JrOp> {
  const wrap = (op: JrOp, win: { first: number; last: number }): Required<JrOp> => ({
    headway: op.headway,
    speed: op.speed,
    offset: op.offset,
    minHw: op.minHw,
    first: op.first ?? win.first,
    last: op.last ?? win.last,
  });
  if (line.kind === "shinkansen") {
    return wrap(SHINK[line.name] ?? { headway: 15, speed: 200, offset: 4, minHw: 8 }, { first: 6 * 60, last: 21 * 60 + 40 });
  }
  if (line.kind === "jr") {
    for (const [key, op] of JR) {
      if (line.name.includes(key)) {
        const last = op.headway >= 30 ? 22 * 60 + 20 : op.headway >= 12 ? 23 * 60 + 50 : 24 * 60 + 50;
        const first = op.headway >= 30 ? 6 * 60 : op.headway >= 12 ? 5 * 60 + 10 : 4 * 60 + 40;
        return wrap(op, { first, last });
      }
    }
    return wrap({ headway: 25, speed: 65, offset: Math.abs(hash(line.name)) % 12, minHw: 12 }, { first: 5 * 60 + 40, last: 23 * 60 + 10 });
  }
  if (line.kind === "subway") {
    return wrap({ headway: line.headway, speed: line.speed, offset: 0, minHw: 2 }, { first: 5 * 60, last: 24 * 60 + 50 });
  }
  if (line.kind === "bus") {
    return wrap({ headway: line.headway, speed: line.speed, offset: 0, minHw: 4 }, { first: 6 * 60, last: 22 * 60 + 40 });
  }
  return wrap({ headway: line.headway, speed: line.speed, offset: 0, minHw: 3 }, { first: 5 * 60 + 10, last: 23 * 60 + 50 });
}

function hash(s: string) {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n * 33 + s.charCodeAt(i)) | 0;
  return n;
}
