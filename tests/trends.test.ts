import { describe, it, expect } from "vitest";
import { compare, comparePoints } from "@/modules/revenue/trends";

describe("compare : « ce chiffre est-il normal ? »", () => {
  it("hausse modérée : flèche vers le haut, pas inhabituel, ton positif", () => {
    const d = compare(120, 100);
    expect(d.direction).toBe("up");
    expect(d.pct).toBeCloseTo(20, 5);
    expect(d.unusual).toBe(false);
    expect(d.tone).toBe("positive");
  });

  it("forte baisse : inhabituelle, ton négatif", () => {
    const d = compare(50, 100);
    expect(d.direction).toBe("down");
    expect(d.unusual).toBe(true);
    expect(d.tone).toBe("negative");
  });

  it("moins de 2 % d'écart : stable, sans ton", () => {
    const d = compare(101, 100);
    expect(d.direction).toBe("flat");
    expect(d.tone).toBe(undefined);
  });

  it("base trop faible : pas de comparaison", () => {
    const d = compare(10, 2, { minBase: 5 });
    expect(d.direction).toBe("na");
    expect(d.pct).toBeNull();
    expect(d.text).toContain("base trop faible");
  });

  it("valeur absente : pas de comparaison", () => {
    expect(compare(null, 5).direction).toBe("na");
    expect(compare(5, null).direction).toBe("na");
  });

  it("goodWhen « down » : une hausse est mauvaise", () => {
    expect(compare(120, 100, { goodWhen: "down" }).tone).toBe("negative");
    expect(compare(80, 100, { goodWhen: "down" }).tone).toBe("positive");
  });

  it("le seuil d'écart inhabituel est réglable", () => {
    expect(compare(115, 100, { threshold: 10 }).unusual).toBe(true);
    expect(compare(115, 100, { threshold: 30 }).unusual).toBe(false);
  });
});

describe("comparePoints : variation d'un pourcentage en points", () => {
  it("98 → 95 = −3 points, pas encore inhabituel", () => {
    const d = comparePoints(95, 98);
    expect(d.direction).toBe("down");
    expect(d.pct).toBeCloseTo(-3, 5);
    expect(d.unusual).toBe(false);
    expect(d.text).toContain("pts");
  });

  it("98 → 90 = −8 points : inhabituel et négatif", () => {
    const d = comparePoints(90, 98);
    expect(d.unusual).toBe(true);
    expect(d.tone).toBe("negative");
  });

  it("valeurs absentes : pas de comparaison", () => {
    expect(comparePoints(null, 98).direction).toBe("na");
  });
});
