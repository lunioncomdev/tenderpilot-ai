import { Fragment } from "react";

/**
 * Rendu Markdown minimal et sûr (aucun HTML injecté) : titres, listes, tableaux,
 * gras / italique, marqueurs [À VALIDER] et [À COMPLÉTER] surlignés.
 */
function inline(text: string, key: string) {
  return text.split(/(\[À VALIDER\]|\[À COMPLÉTER[^\]]*\]|\*\*[^*]+\*\*|\*[^*]+\*)/).map((seg, i) => {
    const k = `${key}-${i}`;
    if (!seg) return null;
    if (seg.startsWith("[À ")) return <mark key={k} className="rounded bg-warning/30 px-1 font-semibold text-foreground">{seg}</mark>;
    if (seg.startsWith("**") && seg.endsWith("**")) return <strong key={k}>{seg.slice(2, -2)}</strong>;
    if (seg.startsWith("*") && seg.endsWith("*") && seg.length > 2) return <em key={k}>{seg.slice(1, -1)}</em>;
    return <Fragment key={k}>{seg}</Fragment>;
  });
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    const key = `b${i}`;
    if (!t) { i++; continue; }
    if (t.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      out.push(
        <table key={key}><tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => (ri === 0 ? <th key={ci}>{inline(c, `${key}${ri}${ci}`)}</th> : <td key={ci}>{inline(c, `${key}${ri}${ci}`)}</td>))}</tr>)}</tbody></table>,
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) { out.push(<h3 key={key}>{inline(h[2], key)}</h3>); i++; continue; }
    if (/^([-*•]|\d+[.)])\s+/.test(t)) {
      const ordered = /^\d/.test(t);
      const items: string[] = [];
      while (i < lines.length && /^([-*•]|\d+[.)])\s+/.test(lines[i].trim())) items.push(lines[i++].trim().replace(/^([-*•]|\d+[.)])\s+/, ""));
      const L = ordered ? "ol" : "ul";
      out.push(<L key={key}>{items.map((it, j) => <li key={j}>{inline(it, `${key}${j}`)}</li>)}</L>);
      continue;
    }
    const para = [t];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#|[-*•]\s|\d+[.)]\s|\|)/.test(lines[i].trim())) para.push(lines[i++].trim());
    out.push(<p key={key}>{inline(para.join(" "), key)}</p>);
  }
  return <div className="prose-md text-sm leading-relaxed">{out}</div>;
}
