import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "J";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      { name: "description", content: "日本全国の電車の位置と発車案内を3D地図で。" },
      { name: "theme-color", content: "#0a1016" },
      { name: "application-name", content: APP_NAME },
      { name: "apple-mobile-web-app-title", content: APP_NAME },
      { name: "apple-mobile-web-app-status-bar-style", content: "black" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", href: "/icon-192.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
    ],
  }),
  component: () => (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(navigator.serviceWorker){navigator.serviceWorker.register("/sw.js?v=30",{scope:"/"}).catch(function(){});}}catch(e){}function ping(){try{if(window.parent&&window.parent!==window){window.parent.postMessage({channel:"grok-preview-bridge",version:1,type:"ready"},"*");}}catch(e){}}ping();[0,50,200,500,1000,2000,4000,8000].forEach(function(ms){setTimeout(ping,ms);});function lockUi(){try{var html=document.documentElement;html.style.fontSize="16px";var p=document.createElement("div");p.style.cssText="position:absolute;left:0;top:0;width:16px;height:16px;font-size:16px;line-height:16px;padding:0;margin:0;border:0;visibility:hidden;pointer-events:none";p.textContent="M";html.appendChild(p);var z=Math.max(p.getBoundingClientRect().width||16,p.getBoundingClientRect().height||16)/16;p.remove();if(z>1.08)html.style.fontSize=(16/Math.min(z,2.8))+"px";}catch(e){}}lockUi();window.addEventListener("resize",lockUi);if(window.visualViewport)window.visualViewport.addEventListener("resize",lockUi);})();`,
          }}
        />
        <HeadContent />
      </head>
      <body className="antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){function ping(){try{if(window.parent){window.parent.postMessage({channel:"grok-preview-bridge",version:1,type:"ready"},"*");}}catch(e){}}function fonts(){try{if(document.getElementById("jb-fonts"))return;var l=document.createElement("link");l.id="jb-fonts";l.rel="stylesheet";l.href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600&display=swap";document.head.appendChild(l);}catch(e){}}ping();fonts();})();`,
          }}
        />
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
