import { describe, expect, it } from "vitest";
import { bouwImport, geoborderLookupUitRijen } from "../aixmImport";

const DATASET = "11111111-1111-1111-1111-111111111111";
const GRENS = "a0d40d3b-2bbf-4733-9d3b-5cbc098c21c9";

/**
 * Een gebied zoals EHWO: een boog van 8 NM, twee rechte stukken en een deel van
 * de landsgrens. Precies het geval waar `parseAixm` een polygoon van vijf punten
 * van maakt — de boog blijft één punt, de grens één rechte lijn.
 *
 * Dat is niet alleen op de kaart zichtbaar: `formatGeometryForLARA` leest
 * dezelfde vorm, dus de kolom `Coordinates` in de export zou net zo grof zijn.
 */
const boogEnGrens = `
<AIXMBasicMessage xmlns:aixm="http://www.aixm.aero/schema/5.1" xmlns:gml="http://www.opengis.net/gml/3.2"
                  xmlns:xlink="http://www.w3.org/1999/xlink">
  <aixm:hasMember>
    <aixm:GeoBorder gml:id="GB1">
      <gml:identifier codeSpace="urn:uuid:">${GRENS}</gml:identifier>
      <aixm:timeSlice>
        <aixm:GeoBorderTimeSlice gml:id="GBTS1">
          <aixm:name>BELGIUM_NETHERLANDS</aixm:name>
          <aixm:border>
            <gml:Curve gml:id="C1">
              <gml:segments>
                <gml:GeodesicString>
                  <gml:posList>
                    51.4230 4.5354 51.4100 4.4800 51.3980 4.4200 51.3850 4.3600
                    51.3700 4.3000 51.3600 4.2700 51.3539 4.2420
                  </gml:posList>
                </gml:GeodesicString>
              </gml:segments>
            </gml:Curve>
          </aixm:border>
        </aixm:GeoBorderTimeSlice>
      </aixm:timeSlice>
    </aixm:GeoBorder>
  </aixm:hasMember>

  <aixm:hasMember>
    <aixm:Airspace gml:id="uuid.11111111-2222-3333-4444-555555555555">
      <gml:identifier codeSpace="urn:uuid:">11111111-2222-3333-4444-555555555555</gml:identifier>
      <aixm:timeSlice>
        <aixm:AirspaceTimeSlice>
          <aixm:interpretation>BASELINE</aixm:interpretation>
          <aixm:type>CTR</aixm:type>
          <aixm:designator>EHWO</aixm:designator>
          <aixm:name>WOENSDRECHT</aixm:name>
          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:operation>BASE</aixm:operation>
              <aixm:theAirspaceVolume>
                <aixm:AirspaceVolume>
                  <aixm:lowerLimit uom="FT">0</aixm:lowerLimit>
                  <aixm:lowerLimitReference>SFC</aixm:lowerLimitReference>
                  <aixm:upperLimit uom="FT">3000</aixm:upperLimit>
                  <aixm:upperLimitReference>MSL</aixm:upperLimitReference>
                  <aixm:horizontalProjection>
                    <aixm:Surface srsName="urn:ogc:def:crs:EPSG::4326" gml:id="S1">
                      <gml:patches><gml:PolygonPatch><gml:exterior><gml:Ring>
                        <gml:curveMember>
                          <gml:Curve gml:id="C2"><gml:segments>
                            <gml:ArcByCenterPoint interpolation="circularArcCenterPointWithRadius" numArc="1">
                              <gml:pos>51.4490 4.3421</gml:pos>
                              <gml:radius uom="[nmi_i]">8.0</gml:radius>
                              <gml:startAngle uom="deg">-145.9</gml:startAngle>
                              <gml:endAngle uom="deg">99.3</gml:endAngle>
                            </gml:ArcByCenterPoint>
                          </gml:segments></gml:Curve>
                        </gml:curveMember>
                        <gml:curveMember>
                          <gml:Curve gml:id="C3"><gml:segments><gml:GeodesicString>
                            <gml:posList>51.4272 4.5530 51.4230 4.5354</gml:posList>
                          </gml:GeodesicString></gml:segments></gml:Curve>
                        </gml:curveMember>
                        <gml:curveMember xlink:href="urn:uuid:${GRENS}"/>
                        <gml:curveMember>
                          <gml:Curve gml:id="C4"><gml:segments><gml:GeodesicString>
                            <gml:posList>51.3539 4.2420 51.3386 4.2229</gml:posList>
                          </gml:GeodesicString></gml:segments></gml:Curve>
                        </gml:curveMember>
                      </gml:Ring></gml:exterior></gml:PolygonPatch></gml:patches>
                    </aixm:Surface>
                  </aixm:horizontalProjection>
                </aixm:AirspaceVolume>
              </aixm:theAirspaceVolume>
            </aixm:AirspaceGeometryComponent>
          </aixm:geometryComponent>
        </aixm:AirspaceTimeSlice>
      </aixm:timeSlice>
    </aixm:Airspace>
  </aixm:hasMember>
</AIXMBasicMessage>
`;

/** Alle coördinaatparen in een geneste array tellen. */
const telPunten = (waarde: unknown): number => {
  if (!Array.isArray(waarde)) return 0;
  if (typeof waarde[0] === "number") return 1;
  return waarde.reduce<number>((n, deel) => n + telPunten(deel), 0);
};

/**
 * Het eerste échte volume, niet de samenvoegrij.
 *
 * `geometries` bevat per gebied ook een rij met operatie `AGG` — de vorm van het
 * geheel. Die staat vooraan, dus wie blind `rijen[0]` pakt meet de verkeerde.
 */
const puntenVanEersteVolume = (rijen: { operation?: string | null; geojson?: unknown }[]) => {
  const volume = rijen.find((r) => r.operation !== "AGG") ?? rijen[0];
  return telPunten((volume?.geojson as { geometry?: { coordinates?: unknown } } | null)?.geometry?.coordinates);
};

describe("volledige vorm", () => {
  it("schrijft de geometrietekst met boog en grens", async () => {
    const { airspaceRijen } = await bouwImport(boogEnGrens, DATASET);
    const tekst = airspaceRijen[0].geometry ?? "";

    expect(tekst).toContain("ARC(");
    expect(tekst).toContain(`BORDER(${GRENS}`);
  });

  it("interpoleert de boog en volgt de grens in de opgeslagen vorm", async () => {
    const { geometrieRijen } = await bouwImport(boogEnGrens, DATASET);
    const punten = puntenVanEersteVolume(geometrieRijen);

    // Vier ankerpunten plus de sluiting zou vijf zijn. De boog levert er
    // tientallen op en de grens zeven.
    expect(punten).toBeGreaterThan(30);
  });

  it("werkt ook als de grens alleen in de tabel staat", async () => {
    const zonder = boogEnGrens.replace(/<aixm:GeoBorder\b[\s\S]*?<\/aixm:GeoBorder>/, "");
    const uitTabel = geoborderLookupUitRijen([
      {
        border_id: GRENS,
        geojson: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [4.5354, 51.423],
              [4.48, 51.41],
              [4.42, 51.398],
              [4.36, 51.385],
              [4.3, 51.37],
              [4.27, 51.36],
              [4.242, 51.3539],
            ],
          },
        },
      },
    ]);

    const { geometrieRijen, samenvatting } = await bouwImport(zonder, DATASET, uitTabel);

    expect(samenvatting.onopgelosteGrenzen).toEqual([]);
    expect(puntenVanEersteVolume(geometrieRijen)).toBeGreaterThan(30);
  });

  it("geeft ook de samenvoegrij de volledige vorm", async () => {
    // Die rij beschrijft het gebied als geheel en wordt geleend door gebieden
    // die ernaar verwijzen; met vijf punten zou dat lenen waardeloos zijn.
    const { geometrieRijen } = await bouwImport(boogEnGrens, DATASET);
    const agg = geometrieRijen.find((r) => r.operation === "AGG");

    expect(agg, "geen samenvoegrij").toBeDefined();
    expect(
      telPunten((agg!.geojson as { geometry?: { coordinates?: unknown } } | null)?.geometry?.coordinates)
    ).toBeGreaterThan(30);
  });

  it("laat een gewoon polygoon met rust", async () => {
    // Zonder boog of grens valt er niets te expanderen; dan blijft de vorm van
    // de parser staan, punt voor punt zoals AIXM hem geeft.
    const simpel = boogEnGrens
      .replace(/<aixm:GeoBorder\b[\s\S]*?<\/aixm:GeoBorder>/, "")
      .replace(/<gml:curveMember>[\s\S]*?<\/gml:curveMember>\s*<gml:curveMember xlink:href[^>]*\/>/, "")
      .replace(/<gml:curveMember xlink:href[^>]*\/>/, "");

    const { geometrieRijen } = await bouwImport(simpel, DATASET);
    expect(puntenVanEersteVolume(geometrieRijen)).toBeGreaterThan(0);
  });
});
