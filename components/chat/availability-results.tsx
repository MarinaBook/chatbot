"use client";

import { ExternalLinkIcon } from "lucide-react";
import type { MarinaBookAvailabilityResult } from "@/lib/ai/marinabook-ai-search";
import { isMarinaBookUrl } from "@/lib/marinabook-metadata";

function formatPrice(price: number | undefined, currency: string | undefined) {
  if (typeof price !== "number") {
    return null;
  }
  return currency ? `${price} ${currency}` : String(price);
}

// Renders the availability results returned by the MarinaBook backend, verbatim
// (no rewriting of the reply). The booking link is the one place a berth is
// booked; it is re-validated as a safe HTTPS MarinaBook URL before rendering
// and opened with rel="noopener noreferrer". No dangerouslySetInnerHTML.
export function AvailabilityResults({
  results,
}: {
  results: MarinaBookAvailabilityResult[];
}) {
  const renderable = results.filter(
    (result) => result.portName || isMarinaBookUrl(result.bookingUrl)
  );

  if (renderable.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Disponibilités"
      className="flex w-[min(100%,450px)] flex-col gap-2"
    >
      {renderable.map((result) => {
        const price = formatPrice(result.price, result.currency);
        const hasBookingUrl = isMarinaBookUrl(result.bookingUrl);
        const key =
          result.bookingUrl ??
          [result.portName, result.placeType, result.price]
            .filter((value) => value !== undefined)
            .join("|");

        return (
          <div
            className="rounded-xl border border-border/50 bg-muted/40 px-3.5 py-3 text-[13px] leading-[1.5]"
            key={key}
          >
            {result.portName ? (
              <p className="font-medium text-foreground">{result.portName}</p>
            ) : null}
            <p className="text-muted-foreground">
              {[result.placeType, price].filter(Boolean).join(" · ")}
            </p>
            {hasBookingUrl ? (
              <a
                className="mt-2 inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-2 hover:underline"
                href={result.bookingUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
                Réserver sur MarinaBook
              </a>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
