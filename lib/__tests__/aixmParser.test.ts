import { describe, expect, it } from "vitest";
import { parseAixm } from "../aixmParser";

const withTimeSlices = `
<AIXMBasicMessage xmlns:aixm="http://www.aixm.aero/schema/5.1" xmlns:gml="http://www.opengis.net/gml/3.2">
  <aixm:hasMember>
    <aixm:Airspace gml:id="AS_TIME">
      <aixm:timeSlice>
        <aixm:AirspaceTimeSlice>
          <aixm:interpretation>BASELINE</aixm:interpretation>
          <aixm:sequenceNumber>1</aixm:sequenceNumber>
          <aixm:designator>SEQ1</aixm:designator>
        </aixm:AirspaceTimeSlice>
        <aixm:AirspaceTimeSlice>
          <aixm:interpretation>BASELINE</aixm:interpretation>
          <aixm:sequenceNumber>5</aixm:sequenceNumber>
          <aixm:correctionNumber>2</aixm:correctionNumber>
          <aixm:designator>SEQ5</aixm:designator>
          <gml:validTime>
            <gml:TimePeriod>
              <gml:beginPosition>2020-01-01T00:00:00Z</gml:beginPosition>
              <gml:endPosition>2100-01-01T00:00:00Z</gml:endPosition>
            </gml:TimePeriod>
          </gml:validTime>
        </aixm:AirspaceTimeSlice>
      </aixm:timeSlice>
    </aixm:Airspace>
  </aixm:hasMember>
</AIXMBasicMessage>
`;

const verticalLimitsXml = `
<AIXMBasicMessage xmlns:aixm="http://www.aixm.aero/schema/5.1" xmlns:gml="http://www.opengis.net/gml/3.2">
  <aixm:hasMember>
    <aixm:Airspace gml:id="AS_VERTICAL">
      <aixm:timeSlice>
        <aixm:AirspaceTimeSlice>
          <aixm:interpretation>BASELINE</aixm:interpretation>
          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:theAirspaceVolume>
                <aixm:upperLimit uom="FL">195</aixm:upperLimit>
                <aixm:upperLimitReference>STD</aixm:upperLimitReference>
                <aixm:lowerLimit uom="FT">1000</aixm:lowerLimit>
                <aixm:lowerLimitReference>MSL</aixm:lowerLimitReference>
                <aixm:horizontalProjection>
                  <gml:Surface>
                    <gml:patches>
                      <gml:PolygonPatch>
                        <gml:exterior>
                          <gml:LinearRing>
                            <gml:posList>52 4 52 5 53 5 52 4</gml:posList>
                          </gml:LinearRing>
                        </gml:exterior>
                      </gml:PolygonPatch>
                    </gml:patches>
                  </gml:Surface>
                </aixm:horizontalProjection>
              </aixm:theAirspaceVolume>
            </aixm:AirspaceGeometryComponent>
          </aixm:geometryComponent>
        </aixm:AirspaceTimeSlice>
      </aixm:timeSlice>
    </aixm:Airspace>
  </aixm:hasMember>
</AIXMBasicMessage>
`;

const multiComponentXml = `
<AIXMBasicMessage xmlns:aixm="http://www.aixm.aero/schema/5.1" xmlns:gml="http://www.opengis.net/gml/3.2">
  <aixm:hasMember>
    <aixm:Airspace gml:id="AS_GEOM">
      <aixm:timeSlice>
        <aixm:AirspaceTimeSlice>
          <aixm:interpretation>SNAPSHOT</aixm:interpretation>
          <aixm:sequenceNumber>3</aixm:sequenceNumber>
          <aixm:designator>GEOM</aixm:designator>
          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:operation>ADD</aixm:operation>
              <aixm:operationSequence>2</aixm:operationSequence>
              <aixm:theAirspaceVolume>
                <aixm:lowerLimit uom="FT">0</aixm:lowerLimit>
                <aixm:lowerLimitReference>SFC</aixm:lowerLimitReference>
                <aixm:horizontalProjection>
                  <gml:PolygonPatch>
                    <gml:exterior><gml:LinearRing><gml:posList>51 3 51 4 52 4 51 3</gml:posList></gml:LinearRing></gml:exterior>
                  </gml:PolygonPatch>
                </aixm:horizontalProjection>
              </aixm:theAirspaceVolume>
            </aixm:AirspaceGeometryComponent>
          </aixm:geometryComponent>
          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:operation>SUBTRACT</aixm:operation>
              <aixm:operationSequence>3</aixm:operationSequence>
              <aixm:theAirspaceVolume>
                <aixm:horizontalProjection>
                  <gml:PolygonPatch>
                    <gml:exterior><gml:LinearRing><gml:posList>51.2 3.2 51.2 3.4 51.4 3.4 51.2 3.2</gml:posList></gml:LinearRing></gml:exterior>
                  </gml:PolygonPatch>
                </aixm:horizontalProjection>
              </aixm:theAirspaceVolume>
            </aixm:AirspaceGeometryComponent>
          </aixm:geometryComponent>
        </aixm:AirspaceTimeSlice>
      </aixm:timeSlice>
    </aixm:Airspace>
  </aixm:hasMember>
</AIXMBasicMessage>
`;

const contributorOnlyXml = `
<AIXMBasicMessage xmlns:aixm="http://www.aixm.aero/schema/5.1" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:xlink="http://www.w3.org/1999/xlink">
  <aixm:hasMember>
    <aixm:Airspace gml:id="AS_CONTRIB">
      <aixm:timeSlice>
        <aixm:AirspaceTimeSlice>
          <aixm:interpretation>BASELINE</aixm:interpretation>
          <aixm:sequenceNumber>1</aixm:sequenceNumber>
          <aixm:designator>CONTRIB</aixm:designator>
          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:operation>BASE</aixm:operation>
              <aixm:operationSequence>1</aixm:operationSequence>
              <aixm:theAirspaceVolume>
                <aixm:AirspaceVolume>
                  <aixm:contributorAirspace>
                    <aixm:AirspaceVolumeDependency>
                      <aixm:dependency>OTHER</aixm:dependency>
                      <aixm:theAirspace xlink:type="simple" xlink:href="urn:uuid:52cb2bed-45c5-4939-a6f4-3a661bfa66aa"/>
                    </aixm:AirspaceVolumeDependency>
                  </aixm:contributorAirspace>
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

const geometrySlicePreferenceXml = `
<AIXMBasicMessage xmlns:aixm="http://www.aixm.aero/schema/5.1" xmlns:gml="http://www.opengis.net/gml/3.2">
  <aixm:hasMember>
    <aixm:Airspace gml:id="AS_PREF">
      <aixm:timeSlice>
        <!-- Higher sequence but no geometry -->
        <aixm:AirspaceTimeSlice>
          <aixm:interpretation>BASELINE</aixm:interpretation>
          <aixm:sequenceNumber>5</aixm:sequenceNumber>
          <aixm:designator>PREF_NO_GEOM</aixm:designator>
        </aixm:AirspaceTimeSlice>
        <!-- Lower sequence with geometry -->
        <aixm:AirspaceTimeSlice>
          <aixm:interpretation>BASELINE</aixm:interpretation>
          <aixm:sequenceNumber>1</aixm:sequenceNumber>
          <aixm:designator>PREF_WITH_GEOM</aixm:designator>
          <aixm:geometryComponent>
            <aixm:AirspaceGeometryComponent>
              <aixm:theAirspaceVolume>
                <aixm:horizontalProjection>
                  <gml:Surface>
                    <gml:patches>
                      <gml:PolygonPatch>
                        <gml:exterior>
                          <gml:LinearRing>
                            <gml:posList>52 4 52 5 53 5 52 4</gml:posList>
                          </gml:LinearRing>
                        </gml:exterior>
                      </gml:PolygonPatch>
                    </gml:patches>
                  </gml:Surface>
                </aixm:horizontalProjection>
              </aixm:theAirspaceVolume>
            </aixm:AirspaceGeometryComponent>
          </aixm:geometryComponent>
        </aixm:AirspaceTimeSlice>
      </aixm:timeSlice>
    </aixm:Airspace>
  </aixm:hasMember>
</AIXMBasicMessage>
`;

describe("parseAixm timeSlice selection", () => {
  it("chooses the highest sequence BASELINE slice when valid", async () => {
    const result = await parseAixm(withTimeSlices);
    expect(result).toHaveLength(1);
    const airspace = result[0];
    expect(airspace.activeSlice?.designator).toBe("SEQ5");
    expect(airspace.activeSlice?.sequenceNumber).toBe(5);
    expect(airspace.activeSlice?.validTimeBegin).toBe("2020-01-01T00:00:00Z");
    expect(airspace.geometryStatus).toBeDefined();
  });

  it("prefers a slice with usable geometry over a higher sequence slice without geometry", async () => {
    const [airspace] = await parseAixm(geometrySlicePreferenceXml);
    expect(airspace.activeSlice?.designator).toBe("PREF_WITH_GEOM");
    expect(airspace.geometryStatus).not.toBe("missing");
  });
});

describe("parseAixm vertical limits", () => {
  it("extracts lower/upper limits with references", async () => {
    const [airspace] = await parseAixm(verticalLimitsXml);
    const limits = airspace.activeSlice?.verticalLimits;
    expect(limits?.lowerLimit?.value).toBe(1000);
    expect(limits?.lowerLimit?.uom).toBe("FT");
    expect(limits?.lowerLimit?.reference).toBe("MSL");
    expect(limits?.upperLimit?.value).toBe(195);
    expect(limits?.upperLimit?.reference).toBe("STD");
  });
});

describe("parseAixm geometry components", () => {
  it("keeps multiple geometry components with operation data", async () => {
    const [airspace] = await parseAixm(multiComponentXml);
    const components = airspace.activeSlice?.geometryComponents ?? [];
    expect(components).toHaveLength(2);
    const ops = components.map((c) => c.operation);
    expect(ops).toContain("ADD");
    expect(ops).toContain("SUBTRACT");
    expect(components[0].bbox).toBeDefined();
    expect(components[1].geometryStatus).toBeDefined();
  });

  it("extracts contributorAirspace href even when geometry is missing", async () => {
    const [airspace] = await parseAixm(contributorOnlyXml);
    const [component] = airspace.activeSlice?.geometryComponents ?? [];
    expect(component.geometryStatus).toBe("missing");
    expect(component.derivedFromAirspaceId).toBe("52cb2bed-45c5-4939-a6f4-3a661bfa66aa");
  });
});

describe("parseAixm arc continuity", () => {
  const formatCoord = (value: number) => value.toFixed(9).replace(/\.?0+$/, "");
  const destinationPoint = (start: { lat: number; lon: number }, bearingDeg: number, distanceMeters: number) => {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const toDeg = (rad: number) => (rad * 180) / Math.PI;
    const δ = distanceMeters / R;
    const θ = toRad(bearingDeg);
    const φ1 = toRad(start.lat);
    const λ1 = toRad(start.lon);
    const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
    const φ2 = Math.asin(sinφ2);
    const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
    const x = Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2);
    const λ2 = λ1 + Math.atan2(y, x);
    return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
  };

  it("orients ArcByCenterPoint to keep ring continuity", async () => {
    const center = { lat: 0, lon: 0 };
    const radiusNm = 60;
    const radiusMeters = radiusNm * 1852;
    const point0 = destinationPoint(center, 0, radiusMeters);
    const point90 = destinationPoint(center, 90, radiusMeters);

    const p0Lat = formatCoord(point0.lat);
    const p0Lon = formatCoord(point0.lon);
    const p90Lat = formatCoord(point90.lat);
    const p90Lon = formatCoord(point90.lon);

    const xml = `
    <AIXMBasicMessage xmlns:aixm="http://www.aixm.aero/schema/5.1" xmlns:gml="http://www.opengis.net/gml/3.2">
      <aixm:hasMember>
        <aixm:Airspace gml:id="AS_ARC_CONT">
          <aixm:timeSlice>
            <aixm:AirspaceTimeSlice>
              <aixm:interpretation>BASELINE</aixm:interpretation>
              <aixm:geometryComponent>
                <aixm:AirspaceGeometryComponent>
                  <aixm:theAirspaceVolume>
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
                                        <gml:posList>${formatCoord(point90.lat + 0.05)} ${formatCoord(point90.lon + 0.05)} ${p90Lat} ${p90Lon}</gml:posList>
                                      </gml:GeodesicString>
                                    </gml:segments>
                                  </gml:Curve>
                                </gml:curveMember>
                                <gml:curveMember>
                                  <gml:Curve>
                                    <gml:segments>
                                      <gml:ArcByCenterPoint>
                                        <gml:pos>${formatCoord(center.lat)} ${formatCoord(center.lon)}</gml:pos>
                                        <gml:radius uom="NM">${radiusNm}</gml:radius>
                                        <gml:startAngle>0</gml:startAngle>
                                        <gml:endAngle>90</gml:endAngle>
                                      </gml:ArcByCenterPoint>
                                    </gml:segments>
                                  </gml:Curve>
                                </gml:curveMember>
                                <gml:curveMember>
                                  <gml:Curve>
                                    <gml:segments>
                                      <gml:GeodesicString>
                                        <gml:posList>${p0Lat} ${p0Lon} ${formatCoord(point0.lat + 0.05)} ${formatCoord(point0.lon + 0.05)}</gml:posList>
                                      </gml:GeodesicString>
                                    </gml:segments>
                                  </gml:Curve>
                                </gml:curveMember>
                              </gml:Ring>
                            </gml:exterior>
                          </gml:PolygonPatch>
                        </gml:patches>
                      </gml:Surface>
                    </aixm:horizontalProjection>
                  </aixm:theAirspaceVolume>
                </aixm:AirspaceGeometryComponent>
              </aixm:geometryComponent>
            </aixm:AirspaceTimeSlice>
          </aixm:timeSlice>
        </aixm:Airspace>
      </aixm:hasMember>
    </AIXMBasicMessage>
    `;

    const [airspace] = await parseAixm(xml);
    const [component] = airspace.activeSlice?.geometryComponents ?? [];
    const geometryString = component?.geometryString ?? "";
    expect(geometryString).toContain(`ARC(${formatCoord(center.lat)},${formatCoord(center.lon)},${radiusNm},CW,${p90Lat},${p90Lon})`);
  });
});
