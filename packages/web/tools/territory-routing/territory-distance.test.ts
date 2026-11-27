import { expect, test } from "bun:test";
import catalogue from "../../src/api/data/territory-road-distances.json";
import { territoryDistance } from "../../src/api/lib/territory-distance";
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
