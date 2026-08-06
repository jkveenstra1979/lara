import { describe, expect, it } from "vitest";
import { bouwImport, geoborderLookupUitRijen } from "../aixmImport";
import { extractGeoborders } from "../geoborderExtract";

const DATASET = "11111111-1111-1111-1111-111111111111";
const GRENS_UUID = "cccccccc-0000-0000-0000-00000000000b";

/**
 * Een gebied waarvan één zijde de landsgrens volgt. De grens zit als GeoBorder
 * in hetzelfde bestand — het geval waarin alles vanzelf goed gaat.
 */
const metGrensInBestand = `
<AIXMBasicMessage xmlns:aixm="http://www.aixm.aero/schema/5.1" xmlns:gml="http://www.opengis.net/gml/3.2"
                  xmlns:xlink="http://www.w3.org/1999/xlink">
  <aixm:hasMember>
    <aixm:GeoBorder gml:id="GB_BE">
      <gml:identifier codeSpace="urn:uuid:">${GRENS_UUID}</gml:identifier>
      <aixm:timeSlice>
        <aixm:GeoBorderTimeSlice gml:id="GBTS_BE">
          <aixm:name>NEDERLAND — BELGIE</aixm:name>
          <aixm:border>
            <gml:Curve gml:id="C_BE">
              <gml:segments>
                <gml:GeodesicString>
                  <gml:posList>51.40 4.20 51.42 4.60 51.45 5.00 51.44 5.40</gml:posList>
                </gml:GeodesicString>
              </gml:segments>
            </gml:Curve>
          </aixm:border>
        </aixm:GeoBorderTimeSlice>
      </aixm:timeSlice>
    </aixm:GeoBorder>
  </aixm:hasMember>

  <aixm:hasMember>
    <aixm:Airspace gml:id="AS_GRENS">
      <gml:identifier codeSpace="urn:uuid:">dddddddd-0000-0000-0000-000000000001</gml:identifier>
      <aixm:timeSlice>
        <aixm:AirspaceTimeSlice>
          <aixm:interpretation>BASELINE</aixm:interpretation>
          <aixm:type>D</aixm:type>
          <aixm:designator>EHD12</aixm:designator>
          <aixm:name>GRENSGEBIED</aixm:name>
          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:operation>BASE</aixm:operation>
              <aixm:operationSequence>1</aixm:operationSequence>
              <aixm:theAirspaceVolume>
                <aixm:AirspaceVolume>
                  <aixm:lowerLimit uom="FT">0</aixm:lowerLimit>
                  <aixm:lowerLimitReference>SFC</aixm:lowerLimitReference>
                  <aixm:upperLimit uom="FL">195</aixm:upperLimit>
                  <aixm:upperLimitReference>STD</aixm:upperLimitReference>
                  <aixm:horizontalProjection>
                    <gml:Surface>
                      <gml:patches>
                        <gml:PolygonPatch>
                          <gml:exterior>
                            <gml:Ring>
                              <gml:curveMember>
                                <gml:Curve>
                                  <gml:segments>
                                    <gml:GeodesicString>
                                      <gml:posList>51.44 5.40 51.80 5.40 51.80 4.20 51.40 4.20</gml:posList>
                                    </gml:GeodesicString>
                                  </gml:segments>
                                </gml:Curve>
                              </gml:curveMember>
                              <gml:curveMember xlink:href="urn:uuid:${GRENS_UUID}"/>
                            </gml:Ring>
                          </gml:exterior>
                        </gml:PolygonPatch>
                      </gml:patches>
                    </gml:Surface>
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

/** Hetzelfde gebied, maar zonder de GeoBorder in het bestand. */
const zonderGrensInBestand = metGrensInBestand.replace(
  /<aixm:hasMember>\s*<aixm:GeoBorder[\s\S]*?<\/aixm:GeoBorder>\s*<\/aixm:hasMember>/,
  ""
);

describe("extractGeoborders", () => {
  it("haalt de landsgrens met naam en coördinaten uit het bestand", async () => {
    const grenzen = await extractGeoborders(metGrensInBestand);

    expect(grenzen).toHaveLength(1);
    expect(grenzen[0].borderId).toBe(GRENS_UUID);
    expect(grenzen[0].name).toBe("NEDERLAND — BELGIE");
    // posList is lat/lon, coördinaten worden lon/lat.
    expect(grenzen[0].coords[0]).toEqual([4.2, 51.4]);
    expect(grenzen[0].coords).toHaveLength(4);
  });

  it("levert een lege lijst voor een bestand zonder grenzen", async () => {
    expect(await extractGeoborders(zonderGrensInBestand)).toEqual([]);
  });
});

describe("bouwImport", () => {
  it("telt de grenzen die uit het bestand zelf komen", async () => {
    const { samenvatting } = await bouwImport(metGrensInBestand, DATASET);

    expect(samenvatting.geobordersUitBestand).toBe(1);
    expect(samenvatting.airspaces).toBe(1);
  });

  it("meldt een grens die nergens te vinden is, mét de gebieden die erop wachten", async () => {
    const { samenvatting } = await bouwImport(zonderGrensInBestand, DATASET);

    expect(samenvatting.geobordersUitBestand).toBe(0);
    expect(samenvatting.onopgelosteGrenzen).toHaveLength(1);
    expect(samenvatting.onopgelosteGrenzen[0].uuid).toBe(GRENS_UUID);
    expect(samenvatting.onopgelosteGrenzen[0].gebieden).toEqual(["EHD12"]);
    expect(samenvatting.onopgelost).toBe(1);
  });

  it("noemt een gebied met een ontbrekende grens niet langer 'ok'", async () => {
    // Dit is de kern van het risico uit § 7. Ontbreekt de landsgrens, dan sluit
    // de parser de ring met een rechte lijn tussen de twee ankerpunten, meldt
    // niets, en zet geometryStatus op "ok". Er komt dus een gebied met een
    // vérkeerde vorm in de export — en dat valt minder op dan een lege kolom.
    const { airspaceRijen } = await bouwImport(zonderGrensInBestand, DATASET);
    const gebied = airspaceRijen[0];

    expect(gebied.geometry_status).toBe("partial");
    expect(gebied.geometry).toContain(`BORDER(${GRENS_UUID}`);
    expect(gebied.warnings_json).toEqual(
      expect.arrayContaining([expect.stringContaining("rechte lijn")])
    );
  });

  it("noemt hetzelfde gebied wél 'ok' zodra de grens er is", async () => {
    const { airspaceRijen } = await bouwImport(metGrensInBestand, DATASET);

    expect(airspaceRijen[0].geometry_status).toBe("ok");
    expect(airspaceRijen[0].warnings_json).toBeNull();
  });

  it("lost dezelfde grens alsnog op uit de tabel", async () => {
    const uitTabel = geoborderLookupUitRijen([
      {
        border_id: `urn:uuid:${GRENS_UUID}`,
        geojson: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [4.2, 51.4],
              [4.6, 51.42],
              [5.0, 51.45],
              [5.4, 51.44],
            ],
          },
        },
      },
    ]);

    const { samenvatting } = await bouwImport(zonderGrensInBestand, DATASET, uitTabel);

    expect(samenvatting.geobordersUitTabel).toBe(1);
    expect(samenvatting.onopgelosteGrenzen).toEqual([]);
  });

  it("schrijft rijen weg die op het schema passen", async () => {
    const { airspaceRijen, geometrieRijen, snippetRijen } = await bouwImport(metGrensInBestand, DATASET);

    const gebied = airspaceRijen[0];
    expect(gebied.dataset_id).toBe(DATASET);
    expect(gebied.ident).toBe("EHD12");
    expect(gebied.type).toBe("D");
    expect(gebied.upperlimit).toBe(195);
    expect(gebied.upperunit).toBe("FL");

    // Elke geometrierij hangt aan het gebied en heeft een toegestane operatie.
    for (const rij of geometrieRijen) {
      expect(rij.airspace_id).toBe(gebied.id);
      expect(["BASE", "UNION", "SUBTR", "INTERS", "AGG"]).toContain(rij.operation);
    }

    // De XML-fragmenten zijn op UUID te vinden, dat is de sleutel in het schema.
    expect(snippetRijen.every((r) => r.dataset_id === DATASET && r.uuid.length > 0)).toBe(true);
  });

  it("koppelt ook als AeroDB een 'uuid.'-prefix in gml:id zet", async () => {
    // Echte AeroDB-export schrijft gml:id="uuid.<uuid>"; de parser strookt die
    // prefix eraf. Zonder dezelfde normalisatie bij het koppelen blijft
    // uuid_identifier null — en dan is er geen AIXM-tab en geen timesheet.
    const metPrefix = metGrensInBestand
      .replace('gml:id="AS_GRENS"', 'gml:id="uuid.dddddddd-0000-0000-0000-000000000001"');
    const { airspaceRijen, snippetRijen } = await bouwImport(metPrefix, DATASET);

    expect(airspaceRijen[0].uuid_identifier).toBe("dddddddd-0000-0000-0000-000000000001");
    expect(snippetRijen.some((r) => r.uuid === airspaceRijen[0].uuid_identifier)).toBe(true);
  });

  it("koppelt elk gebied aan zijn XML-fragment", async () => {
    // Deze koppeling loopt via gml:id, niet via activeSlice.identifier: dat
    // laatste komt uit de timeslice en is meestal leeg, terwijl de snippet-index
    // op de gml:identifier van het Airspace-element sleutelt. Ging dit mis, dan
    // bleef de AIXM-tab in het detailpaneel leeg zonder dat iets erover klaagde.
    const { airspaceRijen, snippetRijen } = await bouwImport(metGrensInBestand, DATASET);
    const gebied = airspaceRijen[0];

    expect(gebied.uuid_identifier).toBe("dddddddd-0000-0000-0000-000000000001");

    const fragment = snippetRijen.find((r) => r.uuid === gebied.uuid_identifier);
    expect(fragment, "geen XML-fragment voor dit gebied").toBeDefined();
    expect(fragment!.snippet).toContain("EHD12");
  });
});

describe("geoborderLookupUitRijen", () => {
  it("neemt de buitenring van een Polygon", () => {
    const lookup = geoborderLookupUitRijen([
      {
        border_id: "abc",
        geojson: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [4, 51],
                [5, 51],
                [5, 52],
                [4, 51],
              ],
              [[4.4, 51.4]],
            ],
          },
        },
      },
    ]);

    expect(lookup.abc).toHaveLength(4);
  });

  it("slaat rijen zonder bruikbare geometrie over", () => {
    expect(
      geoborderLookupUitRijen([
        { border_id: "leeg", geojson: null },
        { border_id: "punt", geojson: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [4, 51] } } },
      ])
    ).toEqual({});
  });
});
