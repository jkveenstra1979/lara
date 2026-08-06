import { describe, expect, it } from "vitest";
import {
  extractTimesheets,
  normaliseerEindtijd,
  timesheetNaarLara,
  timesheetsNaarLara,
} from "../laraTimesheets";

/** Het fragment uit de LVNL-mail van 5 augustus 2026 — echte AeroDB-export. */
const LVNL_FRAGMENT = `
<aixm:activation>
  <aixm:AirspaceActivation gml:id="id.915855ae">
    <aixm:timeInterval>
      <aixm:Timesheet gml:id="id.32eba4c2">
        <aixm:timeReference>UTC</aixm:timeReference>
        <aixm:startDate>01-01</aixm:startDate>
        <aixm:endDate>31-12</aixm:endDate>
        <aixm:day>ANY</aixm:day>
        <aixm:startTime>00:00</aixm:startTime>
        <aixm:endTime>00:00</aixm:endTime>
        <aixm:daylightSavingAdjust>NO</aixm:daylightSavingAdjust>
        <aixm:excluded>NO</aixm:excluded>
      </aixm:Timesheet>
    </aixm:timeInterval>
    <aixm:activity>HELI_TFC</aixm:activity>
    <aixm:status>ACTIVE</aixm:status>
  </aixm:AirspaceActivation>
</aixm:activation>`;

describe("extractTimesheets", () => {
  it("haalt de timesheet uit een echt AIXM-fragment", () => {
    const [ts] = extractTimesheets(LVNL_FRAGMENT);

    expect(ts).toEqual({
      day: "ANY",
      startTime: "00:00",
      endTime: "00:00",
      startDate: "01-01",
      endDate: "31-12",
      excluded: "NO",
    });
  });

  it("vindt meerdere timesheets in één gebied", () => {
    const twee = LVNL_FRAGMENT + LVNL_FRAGMENT.replace("ANY", "SAT");
    expect(extractTimesheets(twee).map((t) => t.day)).toEqual(["ANY", "SAT"]);
  });

  it("geeft niets terug zonder fragment", () => {
    expect(extractTimesheets(null)).toEqual([]);
    expect(extractTimesheets("<aixm:Airspace/>")).toEqual([]);
  });
});

describe("normaliseerEindtijd", () => {
  it("maakt van middernacht een etmaal", () => {
    // AIXM sluit een etmaal af met 00:00; LARA eist een eindtijd ná de starttijd.
    expect(normaliseerEindtijd("00:00", "00:00")).toBe("24:00");
    expect(normaliseerEindtijd("07:00", "00:00")).toBe("24:00");
  });

  it("laat een gewone eindtijd staan", () => {
    expect(normaliseerEindtijd("07:00", "15:45")).toBe("15:45");
    expect(normaliseerEindtijd("00:00", "24:00")).toBe("24:00");
  });
});

describe("timesheetNaarLara", () => {
  it("vertaalt ANY naar de hele week", () => {
    const { rijen } = timesheetNaarLara({ day: "ANY", startTime: "00:00", endTime: "00:00" });

    expect(rijen).toEqual([{ dayFrom: "MON", dayTil: "SUN", startTime: "00:00", endTime: "24:00" }]);
  });

  it("vertaalt WORK_DAY naar maandag tot en met vrijdag", () => {
    const { rijen } = timesheetNaarLara({ day: "WORK_DAY", startTime: "07:00", endTime: "19:00" });

    expect(rijen).toEqual([{ dayFrom: "MON", dayTil: "FRI", startTime: "07:00", endTime: "19:00" }]);
  });

  it("gebruikt de dagnamen uit de specificatie, niet die uit AIXM", () => {
    // AIXM schrijft TUE en THU; het document schrijft TUES en THUR.
    expect(timesheetNaarLara({ day: "TUE", startTime: "08:00", endTime: "17:00" }).rijen[0]).toMatchObject({
      dayFrom: "TUES",
      dayTil: "TUES",
    });
    expect(timesheetNaarLara({ day: "THU", startTime: "08:00", endTime: "17:00" }).rijen[0]).toMatchObject({
      dayFrom: "THUR",
      dayTil: "THUR",
    });
  });

  it("slaat een feestdag over en zegt waarom", () => {
    const { rijen, overgeslagen } = timesheetNaarLara({ day: "HOL", startTime: "00:00", endTime: "00:00" });

    expect(rijen).toEqual([]);
    expect(overgeslagen[0].reden).toContain("Feestdag");
  });

  it("slaat een uitzonderingsperiode over", () => {
    // "excluded" betekent: juist níét actief. Dat is niet om te keren naar een
    // Day From / Day Til, dus liever zichtbaar overslaan dan verkeerd vertalen.
    const { rijen, overgeslagen } = timesheetNaarLara({
      day: "ANY",
      startTime: "00:00",
      endTime: "00:00",
      excluded: "YES",
    });

    expect(rijen).toEqual([]);
    expect(overgeslagen[0].reden).toContain("uitzondering");
  });

  it("weigert een onbruikbare tijd", () => {
    const { rijen, overgeslagen } = timesheetNaarLara({ day: "MON", startTime: "zeven", endTime: "17:00" });

    expect(rijen).toEqual([]);
    expect(overgeslagen[0].reden).toContain("Onbruikbare tijd");
  });
});

describe("timesheetsNaarLara", () => {
  it("ontdubbelt herhaalde timesheets", () => {
    // AIXM herhaalt dezelfde tijden vaak per activiteit; LARA heeft er één nodig.
    const { rijen } = timesheetsNaarLara([
      { day: "ANY", startTime: "00:00", endTime: "00:00" },
      { day: "ANY", startTime: "00:00", endTime: "00:00" },
      { day: "SAT", startTime: "09:00", endTime: "17:00" },
    ]);

    expect(rijen).toHaveLength(2);
    expect(rijen[1]).toEqual({ dayFrom: "SAT", dayTil: "SAT", startTime: "09:00", endTime: "17:00" });
  });

  it("houdt de overgeslagen timesheets bij", () => {
    const { rijen, overgeslagen } = timesheetsNaarLara([
      { day: "MON", startTime: "07:00", endTime: "19:00" },
      { day: "HOL", startTime: "00:00", endTime: "00:00" },
    ]);

    expect(rijen).toHaveLength(1);
    expect(overgeslagen).toHaveLength(1);
  });
});
