import { describe, expect, it } from "vitest";
import { parseAixm } from "../aixmParser";
import { collectVolumes, envelopeVerticalLimits } from "../airspaceVolumes";

/**
 * Een gebied dat uit drie gelaagde volumes bestaat — het geval dat in de
 * brontool verloren ging. Sheet 2 (Area Volumes) hoort hier drie rijen te
 * krijgen, sheet 1 (Areas) één rij met de omhullende band FL 055–195.
 *
 * Volume 2 verwijst naar een ander gebied (UNION) en geeft zelf geen hoogteband
 * op: die moet van het bronvolume komen.
 */
const gelaagdGebied = `
<AIXMBasicMessage xmlns:aixm="http://www.aixm.aero/schema/5.1" xmlns:gml="http://www.opengis.net/gml/3.2"
                  xmlns:xlink="http://www.w3.org/1999/xlink">
  <aixm:hasMember>
    <aixm:Airspace gml:id="AS_TRA10">
      <gml:identifier codeSpace="urn:uuid:">aaaaaaaa-0000-0000-0000-000000000010</gml:identifier>
      <aixm:timeSlice>
        <aixm:AirspaceTimeSlice>
          <aixm:interpretation>BASELINE</aixm:interpretation>
          <aixm:type>TRA</aixm:type>
          <aixm:designator>EHTRA10</aixm:designator>
          <aixm:name>TRA 10 NOORDZEE</aixm:name>

          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:operation>BASE</aixm:operation>
              <aixm:operationSequence>1</aixm:operationSequence>
              <aixm:theAirspaceVolume>
                <aixm:AirspaceVolume>
                  <aixm:lowerLimit uom="FL">55</aixm:lowerLimit>
                  <aixm:lowerLimitReference>STD</aixm:lowerLimitReference>
                  <aixm:upperLimit uom="FL">95</aixm:upperLimit>
                  <aixm:upperLimitReference>STD</aixm:upperLimitReference>
                  <aixm:horizontalProjection>
                    <gml:Surface>
                      <gml:patches>
                        <gml:PolygonPatch>
                          <gml:exterior>
                            <gml:LinearRing>
                              <gml:posList>52 4 52 5 53 5 53 4 52 4</gml:posList>
                            </gml:LinearRing>
                          </gml:exterior>
                        </gml:PolygonPatch>
                      </gml:patches>
                    </gml:Surface>
                  </aixm:horizontalProjection>
                </aixm:AirspaceVolume>
              </aixm:theAirspaceVolume>
            </aixm:AirspaceGeometryComponent>
          </aixm:geometryComponent>

          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:operation>UNION</aixm:operation>
              <aixm:operationSequence>2</aixm:operationSequence>
              <aixm:theAirspaceVolume>
                <aixm:AirspaceVolume>
                  <aixm:contributorAirspace>
                    <aixm:AirspaceVolumeDependency>
                      <aixm:theAirspace xlink:href="urn:uuid:bbbbbbbb-0000-0000-0000-000000000002"/>
                    </aixm:AirspaceVolumeDependency>
                  </aixm:contributorAirspace>
                </aixm:AirspaceVolume>
              </aixm:theAirspaceVolume>
            </aixm:AirspaceGeometryComponent>
          </aixm:geometryComponent>

          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:operation>SUBTR</aixm:operation>
              <aixm:operationSequence>3</aixm:operationSequence>
              <aixm:theAirspaceVolume>
                <aixm:AirspaceVolume>
                  <aixm:lowerLimit uom="FL">145</aixm:lowerLimit>
                  <aixm:lowerLimitReference>STD</aixm:lowerLimitReference>
                  <aixm:upperLimit uom="FL">195</aixm:upperLimit>
                  <aixm:upperLimitReference>STD</aixm:upperLimitReference>
                  <aixm:horizontalProjection>
                    <gml:Surface>
                      <gml:patches>
                        <gml:PolygonPatch>
                          <gml:exterior>
                            <gml:LinearRing>
                              <gml:posList>52.2 4.2 52.2 4.8 52.8 4.8 52.8 4.2 52.2 4.2</gml:posList>
                            </gml:LinearRing>
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

/** Eén volume, één hoogteband — het gewone geval. */
const enkelGebied = `
<AIXMBasicMessage xmlns:aixm="http://www.aixm.aero/schema/5.1" xmlns:gml="http://www.opengis.net/gml/3.2">
  <aixm:hasMember>
    <aixm:Airspace gml:id="AS_R1">
      <aixm:timeSlice>
        <aixm:AirspaceTimeSlice>
          <aixm:interpretation>BASELINE</aixm:interpretation>
          <aixm:type>R</aixm:type>
          <aixm:designator>EHR1</aixm:designator>
          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:operation>BASE</aixm:operation>
              <aixm:theAirspaceVolume>
                <aixm:AirspaceVolume>
                  <aixm:lowerLimit uom="FT">0</aixm:lowerLimit>
                  <aixm:lowerLimitReference>SFC</aixm:lowerLimitReference>
                  <aixm:upperLimit uom="FL">65</aixm:upperLimit>
                  <aixm:upperLimitReference>STD</aixm:upperLimitReference>
                  <aixm:horizontalProjection>
                    <gml:Surface>
                      <gml:patches>
                        <gml:PolygonPatch>
                          <gml:exterior>
                            <gml:LinearRing>
                              <gml:posList>52 5 52 6 53 6 53 5 52 5</gml:posList>
                            </gml:LinearRing>
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

const eersteSlice = async (xml: string) => {
  const [airspace] = await parseAixm(xml);
  const slice = airspace?.activeSlice;
  if (!slice) throw new Error("geen actieve timeslice");
  return slice;
};

describe("collectVolumes", () => {
  it("levert één volume per geometryComponent, in operationSequence-volgorde", async () => {
    const volumes = collectVolumes(await eersteSlice(gelaagdGebied));

    expect(volumes).toHaveLength(3);
    expect(volumes.map((v) => v.operation)).toEqual(["BASE", "UNION", "SUBTR"]);
    expect(volumes.map((v) => v.operationSequence)).toEqual([1, 2, 3]);
  });

  it("houdt de hoogteband per volume uit elkaar", async () => {
    const volumes = collectVolumes(await eersteSlice(gelaagdGebied));

    expect(volumes[0].lowerLimit).toEqual({ value: 55, unit: "FL", reference: "STD" });
    expect(volumes[0].upperLimit).toEqual({ value: 95, unit: "FL", reference: "STD" });
    expect(volumes[2].lowerLimit).toEqual({ value: 145, unit: "FL", reference: "STD" });
    expect(volumes[2].upperLimit).toEqual({ value: 195, unit: "FL", reference: "STD" });
  });

  it("markeert een volume zonder eigen hoogteband als afgeleid", async () => {
    const volumes = collectVolumes(await eersteSlice(gelaagdGebied));
    const afgeleid = volumes[1];

    expect(afgeleid.operation).toBe("UNION");
    expect(afgeleid.lowerLimit).toBeNull();
    expect(afgeleid.upperLimit).toBeNull();
    expect(afgeleid.derivedFrom).toEqual(["bbbbbbbb-0000-0000-0000-000000000002"]);
  });

  it("geeft één volume terug voor een gewoon gebied", async () => {
    const volumes = collectVolumes(await eersteSlice(enkelGebied));

    expect(volumes).toHaveLength(1);
    expect(volumes[0].upperLimit).toEqual({ value: 65, unit: "FL", reference: "STD" });
    expect(volumes[0].derivedFrom).toEqual([]);
  });
});

describe("envelopeVerticalLimits", () => {
  it("neemt de laagste onder- en de hoogste bovengrens over alle volumes", async () => {
    const omhullend = envelopeVerticalLimits(collectVolumes(await eersteSlice(gelaagdGebied)));

    // Niet FL 055–095 (het eerste volume), maar de hele band.
    expect(omhullend.lowerLimit).toEqual({ value: 55, unit: "FL", reference: "STD" });
    expect(omhullend.upperLimit).toEqual({ value: 195, unit: "FL", reference: "STD" });
  });

  it("vergelijkt over eenheden heen — voet en flight level door elkaar", async () => {
    const omhullend = envelopeVerticalLimits([
      {
        operation: "BASE",
        operationSequence: 1,
        lowerLimit: { value: 0, unit: "FT", reference: "SFC" },
        upperLimit: { value: 3000, unit: "FT", reference: "MSL" },
        derivedFrom: [],
        geometryStatus: "ok",
        geojson: null,
        bbox: undefined,
        geomType: undefined,
        centroidLat: null,
        centroidLon: null,
        warnings: [],
      },
      {
        operation: "UNION",
        operationSequence: 2,
        // FL 055 = 5500 ft, dus dit volume bepaalt de bovengrens.
        lowerLimit: { value: 30, unit: "FL", reference: "STD" },
        upperLimit: { value: 55, unit: "FL", reference: "STD" },
        derivedFrom: [],
        geometryStatus: "ok",
        geojson: null,
        bbox: undefined,
        geomType: undefined,
        centroidLat: null,
        centroidLon: null,
        warnings: [],
      },
    ]);

    expect(omhullend.lowerLimit).toEqual({ value: 0, unit: "FT", reference: "SFC" });
    expect(omhullend.upperLimit).toEqual({ value: 55, unit: "FL", reference: "STD" });
  });

  it("geeft null terug als geen enkel volume een band opgeeft", () => {
    const omhullend = envelopeVerticalLimits([]);
    expect(omhullend.lowerLimit).toBeNull();
    expect(omhullend.upperLimit).toBeNull();
  });
});

describe("wat de brontool verloor", () => {
  it("de timeslice zelf houdt maar één hoogteband over — daarom bestaat collectVolumes", async () => {
    const slice = await eersteSlice(gelaagdGebied);

    // De parser vult slice.verticalLimits met de band van het eerste component
    // dat er één heeft. Voor een gelaagd gebied is dat FL 055–095: de bovengrens
    // van FL 195 is dan weg. Dit legt het bestaande gedrag vast, zodat duidelijk
    // is waarom de import collectVolumes gebruikt en niet slice.verticalLimits.
    expect(slice.verticalLimits?.upperLimit?.value).toBe(95);

    const omhullend = envelopeVerticalLimits(collectVolumes(slice));
    expect(omhullend.upperLimit?.value).toBe(195);
  });
});
