import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { copies } from "@/lib/i18n";
import { canPromptInstall, isIos, isStandalone, promptInstall, watchInstall } from "@/lib/pwa";
import { useMapStore } from "@/store/map-store";

export function InstallChip() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const [ready, setReady] = useState(true);
  const [open, setOpen] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setStandalone(isStandalone());
    setReady(!isStandalone());
    return watchInstall(() => {
      setStandalone(isStandalone());
      setReady(!isStandalone());
    });
  }, []);

  if (standalone || !ready) return null;

  return (
    <>
      <button
        type="button"
        className="flex h-11 items-center gap-1.5 rounded-[var(--radius-md)] bg-surface/94 px-3 text-sm font-medium text-fg shadow-[var(--shadow-border)] backdrop-blur-md"
        onClick={async () => {
          if (canPromptInstall()) {
            await promptInstall();
            return;
          }
          setOpen(true);
        }}
      >
        <Download className="size-4" />
        {t.install}
      </button>
      {open ? (
        <div className="pointer-events-auto fixed inset-x-3 bottom-24 z-40 rounded-[var(--radius-xl)] bg-surface p-4 shadow-[var(--shadow-border)] md:inset-x-auto md:right-4 md:bottom-auto md:top-20 md:w-80">
          <p className="text-sm font-medium text-fg">{t.install}</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">{isIos() ? t.installIos : t.installHint}</p>
          <div className="mt-3 flex justify-end gap-2">
            <a className="rounded-[var(--radius-md)] px-3 py-1.5 text-sm text-accent" href="/?install=1">
              {t.installGuide}
            </a>
            <button type="button" className="rounded-[var(--radius-md)] bg-fg/8 px-3 py-1.5 text-sm" onClick={() => setOpen(false)}>
              {t.close}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
