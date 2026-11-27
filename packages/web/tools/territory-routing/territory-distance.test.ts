import { expect, test } from "bun:test";
import catalogue from "../../src/api/data/territory-road-distances.json";
import { territoryDistance, territoryParishCode } from "../../src/api/lib/territory-distance";
import { TERRITORY_ROUTE_ORIGIN } from "../../src/api/shared/territories";

const santarem = { district: "Santarém", municipality: "Santarém" };

test("resolves a road distance by district, municipality and parish without accents", () => {
  const distance = territoryDistance({ ...santarem, parish: "Alcanhões" });
  expect(distance.status).toBe("ok");
  if (distance.status !== "ok") return;
  expect(distance.meters).toBeGreaterThan(2500);
  expect(distance.meters).toBeLessThan(10000);
  expect(territoryDistance({ district: " santarem ", municipality: "SANTAREM", parish: "Alcanhoes" })).toEqual(distance);
  expect(territoryDistance({ district: "Santarém", municipality: "Almeirim", parish: "Alcanhões" })).toEqual({ status: "not_found" });
});

test("uses official and simplified CAOP names for parish unions", () => {
  const district = "Aveiro";
  const municipality = "Águeda";
  const simplified = territoryDistance({ district, municipality, parish: "Recardães e Espinhel" });
  expect(simplified.status).toBe("ok");
  expect(territoryDistance({ district, municipality, parish: "União das freguesias de Recardães e Espinhel" })).toEqual(simplified);
  expect(territoryDistance({ district, municipality, parish: "U.F. Recardães e Espinhel" })).toEqual(simplified);
});

test("distinguishes no road connection from unrecognised parish and records the origin", () => {
  expect(territoryDistance({ district: "Madeira", municipality: "Calheta", parish: "Prazeres" })).toEqual({ status: "no_route" });
  expect(territoryDistance({ ...santarem, parish: "Freguesia inventada" })).toEqual({ status: "not_found" });
  expect(catalogue.origin.address).toBe(TERRITORY_ROUTE_ORIGIN);
  expect(catalogue.rows.length).toBeGreaterThan(3200);
});

test("resolves the parish identifier for sales with an exact geographic match, including islands", () => {
  expect(territoryParishCode({ ...santarem, parish: " alcanhoes " })).toBe("141605");
  expect(territoryParishCode({ ...santarem, parish: "Alcanhões, zona norte" })).toBeUndefined();
  expect(territoryParishCode({ ...santarem, municipality: "", parish: "Alcanhões" })).toBeUndefined();
  expect(territoryParishCode({ district: "Madeira", municipality: "Calheta", parish: "Prazeres" })).toBeDefined();
});

test("shares the Covilhã parish code and road distance across official and historical names", () => {
  const covilha = { district: "Castelo Branco", municipality: "Covilhã" };
  const official = territoryDistance({ ...covilha, parish: "União das freguesias de Covilhã e Canhoso" });
  expect(official).toEqual({ status: "ok", meters: 193566 });
  for (const parish of ["Covilhã", "COVILHA", "Freguesia da Covilhã", "U.F. de Covilhã e Canhoso", "Covilhã (São Pedro)", "Canhoso"]) {
    expect(territoryParishCode({ ...covilha, parish })).toBe("050335");
    expect(territoryDistance({ ...covilha, parish })).toEqual(official);
  }
  expect(territoryParishCode({ ...covilha, parish: "Teixoso" })).toBe("050337");
  expect(territoryParishCode({ ...covilha, parish: "Aldeia do Souto" })).toBe("050338");
  expect(territoryParishCode({ ...covilha, parish: "Barco" })).toBe("050339");
  expect(territoryParishCode({ ...covilha, parish: "Barco e Coutada" })).toBeUndefined();
  expect(territoryDistance({ ...covilha, municipality: "Fundão", parish: "Covilhã" })).toEqual({ status: "not_found" });
});
