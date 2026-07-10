import { useEffect } from "react";
import type { JsonLdValue } from "../lib/structuredData";

export function JsonLd({ id, data }: { id: string; data: JsonLdValue | JsonLdValue[] }) {
  useEffect(() => {
    const scriptId = `jsonld-${id}`;
    const serialized = serializeJsonLd(data);
    const duplicates = document.querySelectorAll<HTMLScriptElement>(
      `script[type="application/ld+json"][data-jsonld-id="${scriptId}"]`,
    );
    let script = duplicates[0];

    duplicates.forEach((entry, index) => {
      if (index > 0) entry.remove();
    });

    if (!script) {
      script = document.createElement("script");
      script.type = "application/ld+json";
      script.dataset.jsonldId = scriptId;
      document.head.appendChild(script);
    }

    script.textContent = serialized;

    return () => {
      document
        .querySelectorAll<HTMLScriptElement>(
          `script[type="application/ld+json"][data-jsonld-id="${scriptId}"]`,
        )
        .forEach((entry) => entry.remove());
    };
  }, [data, id]);

  return null;
}

function serializeJsonLd(data: JsonLdValue | JsonLdValue[]) {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
