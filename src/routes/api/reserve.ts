import { createFileRoute } from "@tanstack/react-router";

const MAIL = "zhangj31095@gmail.com";
const GATE = `https://formsubmit.co/ajax/${MAIL}`;

type Payload = {
  shop?: string;
  name?: string;
  contact?: string;
  date?: string;
  time?: string;
  guests?: string | number;
  note?: string;
};

export const Route = createFileRoute("/api/reserve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Payload = {};
        try {
          body = (await request.json()) as Payload;
        } catch {
          return Response.json({ ok: false, error: "bad-json" }, { status: 400 });
        }
        const shop = String(body.shop ?? "").trim();
        const name = String(body.name ?? "").trim();
        const contact = String(body.contact ?? "").trim();
        const date = String(body.date ?? "").trim();
        const time = String(body.time ?? "").trim();
        const guests = String(body.guests ?? "").trim();
        const note = String(body.note ?? "").trim();
        if (!shop || !name || !contact || !date || !time || !guests) {
          return Response.json({ ok: false, error: "missing" }, { status: 400 });
        }
        const subject = `【JB map新预约】目标店铺：${shop} | 预约时间：${date} ${time} | 客户信息：${name}`;
        const message = [
          `目标店铺：${shop}`,
          `预约时间：${date} ${time}`,
          `人数：${guests}`,
          `客户姓名：${name}`,
          `联系方式：${contact}`,
          `备注：${note || "（无）"}`,
        ].join("\n");
        try {
          const fd = new FormData();
          fd.append("_subject", subject);
          fd.append("_template", "table");
          fd.append("_captcha", "false");
          fd.append("shop", shop);
          fd.append("name", name);
          fd.append("contact", contact);
          fd.append("date", date);
          fd.append("time", time);
          fd.append("guests", guests);
          fd.append("note", note || "（无）");
          fd.append("message", message);
          const res = await fetch(GATE, {
            method: "POST",
            headers: { Accept: "application/json" },
            body: fd,
          });
          const json = (await res.json().catch(() => ({}))) as { success?: boolean | string; message?: string };
          const ok = json.success === true || json.success === "true" || res.ok;
          const pending = String(json.message ?? "").toLowerCase().includes("confirm") || String(json.message ?? "").includes("Activation");
          if (!ok && !pending && res.status >= 400) throw new Error(String(res.status));
          return Response.json({ ok: true });
        } catch {
          return Response.json({ ok: false, error: "gateway" }, { status: 502 });
        }
      },
    },
  },
});
