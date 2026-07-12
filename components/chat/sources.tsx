"use client";

import { ExternalLinkIcon } from "lucide-react";
import {
  isMarinaBookUrl,
  type MarinaBookSource,
} from "@/lib/marinabook-metadata";

function sourceHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Renders the documentary sources returned by the MarinaBook backend.
// Security: links are re-validated as absolute HTTPS here (defense in depth on
// top of the server-side sanitizer), opened with rel="noopener noreferrer", and
// all text is rendered as plain React children — never dangerouslySetInnerHTML.
export function Sources({ sources }: { sources: MarinaBookSource[] }) {
  const safeSources = sources.filter((source) => isMarinaBookUrl(source.url));

  if (safeSources.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Sources"
      className="w-[min(100%,450px)] rounded-xl border border-border/50 bg-muted/40 px-3.5 py-3"
    >
      <p className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        Sources
      </p>
      <ul className="flex flex-col gap-2">
        {safeSources.map((source) => (
          <li key={source.url}>
            <a
              className="group flex items-start gap-2 text-[13px] leading-[1.5] text-foreground no-underline"
              href={source.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              <ExternalLinkIcon
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0">
                <span className="font-medium underline-offset-2 group-hover:underline">
                  {source.title ?? sourceHostname(source.url)}
                </span>
                {source.snippet ? (
                  <span className="mt-0.5 block break-words text-[12px] text-muted-foreground">
                    {source.snippet}
                  </span>
                ) : null}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
