import { describe, expect, it } from "vitest";
import { parseSort, sortRows } from "@/components/sortable";

const rows = [
  { name: "Écluse", value: 30, date: new Date("2026-11-02") },
  { name: "abeille", value: null, date: new Date("2026-10-01") },
  { name: "Zèbre", value: 5, date: null },
  { name: "bateau", value: 120, date: new Date("2026-12-24") },
];
const accessors = { name: (r: (typeof rows)[number]) => r.name, value: (r: (typeof rows)[number]) => r.value, date: (r: (typeof rows)[number]) => r.date };

describe("tri des tableaux", () => {
  it("lit la colonne et le sens dans l'URL, avec préfixe", () => {
    expect(parseSort({ sort: "value", dir: "desc" }, ["name", "value"], { key: "name", dir: "asc" })).toEqual({ key: "value", dir: "desc" });
    expect(parseSort({ u_sort: "value" }, ["name", "value"], { key: "name", dir: "asc" }, "u_")).toEqual({ key: "value", dir: "asc" });
  });

  it("ignore une colonne inconnue", () => {
    expect(parseSort({ sort: "password" }, ["name"], { key: "name", dir: "desc" })).toEqual({ key: "name", dir: "desc" });
  });

  it("trie le texte à la française (accents, casse)", () => {
    expect(sortRows(rows, { key: "name", dir: "asc" }, accessors).map((r) => r.name)).toEqual(["abeille", "bateau", "Écluse", "Zèbre"]);
  });

  it("garde les valeurs absentes en fin de liste dans les deux sens", () => {
    expect(sortRows(rows, { key: "value", dir: "asc" }, accessors).map((r) => r.value)).toEqual([5, 30, 120, null]);
    expect(sortRows(rows, { key: "value", dir: "desc" }, accessors).map((r) => r.value)).toEqual([120, 30, 5, null]);
    expect(sortRows(rows, { key: "date", dir: "desc" }, accessors).map((r) => r.name)).toEqual(["bateau", "Écluse", "abeille", "Zèbre"]);
  });

  it("ne modifie pas la liste d'origine", () => {
    const copy = [...rows];
    sortRows(rows, { key: "value", dir: "desc" }, accessors);
    expect(rows).toEqual(copy);
  });
});
