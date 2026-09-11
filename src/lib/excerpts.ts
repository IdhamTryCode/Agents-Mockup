import type { Hit, Jenjang } from "./types";
import type { TextExcerpt, FigureExcerpt } from "./contract";
import { matchFigures, type Figure } from "./figures";

/** Split a corpus `source` ("<book title>, <section path> › <leaf>") into
 *  title + section for the handover's `<judul> — <section>` Sources format. */
export function splitSource(source: string): { title: string; section: string } {
  const comma = source.indexOf(",");
  if (comma > 0) {
    return { title: source.slice(0, comma).trim(), section: source.slice(comma + 1).trim() || "—" };
  }
  const angle = source.indexOf("›");
  if (angle > 0) {
    return { title: source.slice(0, angle).trim(), section: source.slice(angle + 1).trim() || "—" };
  }
  return { title: source.trim(), section: "—" };
}

/** Retrieval returns chunks, but Sources lists DOCUMENTS. Several chunks routinely
 *  come from the same book and the same section — a kemagnetan question returned four
 *  of them — and numbering each separately made one source look like four, and let the
 *  model cite [1][2][3][4] for a single fact. Contract §3b: chunks sharing title +
 *  section share one [n]. Merge their passages under that one entry; order follows the
 *  best-ranked chunk of each document since Map keeps insertion order. */
export function hitsToExcerpts(hits: Hit[]): TextExcerpt[] {
  const byDoc = new Map<string, TextExcerpt>();
  for (const h of hits) {
    const { title, section } = splitSource(h.source);
    const key = `${title} ||| ${section}`;
    const seen = byDoc.get(key);
    if (seen) seen.text += `

${h.text}`;
    else byDoc.set(key, { title, section, text: h.text });
  }
  return [...byDoc.values()];
}

/** A figure with its Sources number N — the UI maps [figure:N] back to this. */
export type FigureSource = Figure & { n: number };

/** Attach relevant dummy figures for the student's jenjang. `nOffset` = number of
 *  text excerpts, so figure Sources numbers continue after them (handover: one
 *  shared [n] sequence). */
export function attachFigures(topic: string, jenjang: Jenjang, nOffset: number, limit = 1): {
  figureExcerpts: FigureExcerpt[];
  figureSources: FigureSource[];
} {
  const figs = matchFigures(topic, jenjang, limit);
  const figureExcerpts: FigureExcerpt[] = figs.map((f) => ({
    title: f.title,
    section: f.section,
    figureId: f.id,
    caption: f.caption,
  }));
  const figureSources: FigureSource[] = figs.map((f, i) => ({ ...f, n: nOffset + i + 1 }));
  return { figureExcerpts, figureSources };
}
