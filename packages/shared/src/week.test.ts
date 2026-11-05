import { describe, expect, it } from "vitest";
import { addDays, getISOWeek } from "date-fns";
import { formatWeekRange, getMaxWeekOffset, getWeekStart } from "./week";

/** Lokal tid (Europe/Oslo, se vitest.config.ts). Måned er 1-basert. */
function local(year: number, month: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

function ymd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function expectMidnightMonday(date: Date) {
  expect(date.getDay()).toBe(1);
  expect([date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]).toEqual([0, 0, 0, 0]);
}

describe("tidssone for testene", () => {
  it("kjører i Europe/Oslo", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Europe/Oslo");
  });
});

describe("getWeekStart", () => {
  it("gir mandag kl. 00:00 i samme uke, også når now er mandag eller søndag", () => {
    expect(ymd(getWeekStart(0, local(2025, 3, 12)))).toBe("2025-03-10"); // onsdag
    expect(ymd(getWeekStart(0, local(2025, 3, 10, 0, 0)))).toBe("2025-03-10"); // mandag midnatt
    expect(ymd(getWeekStart(0, local(2025, 3, 16, 23, 59)))).toBe("2025-03-10"); // søndag kveld
    expectMidnightMonday(getWeekStart(0, local(2025, 3, 12)));
  });

  it("går hele uker bakover med positiv offset", () => {
    const now = local(2025, 3, 12);
    expect(ymd(getWeekStart(1, now))).toBe("2025-03-03");
    expect(ymd(getWeekStart(10, now))).toBe("2024-12-30");
  });

  describe("årsskifte", () => {
    it("uke 1 som starter i desember (2024-12-30 – 2025-01-05)", () => {
      const nyttårsdag = local(2025, 1, 1);
      const start = getWeekStart(0, nyttårsdag);
      expect(ymd(start)).toBe("2024-12-30");
      expect(getISOWeek(start)).toBe(1);
      // Uka før er uke 52 i 2024.
      const forrige = getWeekStart(1, nyttårsdag);
      expect(ymd(forrige)).toBe("2024-12-23");
      expect(getISOWeek(forrige)).toBe(52);
    });

    it("uke 53 → uke 1 (2020 har 53 uker)", () => {
      const uke53 = getWeekStart(0, local(2021, 1, 1));
      expect(ymd(uke53)).toBe("2020-12-28");
      expect(getISOWeek(uke53)).toBe(53);

      const uke1 = getWeekStart(0, local(2021, 1, 4));
      expect(ymd(uke1)).toBe("2021-01-04");
      expect(getISOWeek(uke1)).toBe(1);

      expect(ymd(getWeekStart(1, local(2021, 1, 4)))).toBe("2020-12-28");
    });

    it("uke 52 → uke 1 når uke 1 starter i januar (2022/2023)", () => {
      const uke52 = getWeekStart(0, local(2023, 1, 1)); // søndag 1. januar
      expect(ymd(uke52)).toBe("2022-12-26");
      expect(getISOWeek(uke52)).toBe(52);
      expect(ymd(getWeekStart(0, local(2023, 1, 2)))).toBe("2023-01-02");
      expect(getISOWeek(local(2023, 1, 2))).toBe(1);
    });
  });

  describe("sommertid", () => {
    // 2025: sommertid fra søndag 30. mars kl. 02:00, normaltid fra søndag 26. oktober kl. 03:00.
    it("uka som slutter med overgang til sommertid starter mandag 24. mars kl. 00:00", () => {
      for (const now of [local(2025, 3, 30, 1, 30), local(2025, 3, 30, 3, 30), local(2025, 3, 30, 23, 0)]) {
        const start = getWeekStart(0, now);
        expect(ymd(start)).toBe("2025-03-24");
        expectMidnightMonday(start);
      }
    });

    it("uka etter overgang til sommertid starter mandag 31. mars kl. 00:00", () => {
      const start = getWeekStart(0, local(2025, 3, 31, 0, 30));
      expect(ymd(start)).toBe("2025-03-31");
      expectMidnightMonday(start);
      // Uka er 23 timer kortere enn 7 × 24 t, men forrige uke må fortsatt starte på en mandag.
      const forrige = getWeekStart(1, local(2025, 3, 31, 0, 30));
      expect(ymd(forrige)).toBe("2025-03-24");
      expectMidnightMonday(forrige);
    });

    it("uka som slutter med overgang til normaltid starter mandag 20. oktober kl. 00:00", () => {
      for (const now of [local(2025, 10, 26, 2, 30), local(2025, 10, 26, 23, 59)]) {
        const start = getWeekStart(0, now);
        expect(ymd(start)).toBe("2025-10-20");
        expectMidnightMonday(start);
      }
    });

    it("bla bakover over begge overgangene gir alltid mandag midnatt", () => {
      const now = local(2025, 11, 5);
      for (let offset = 0; offset < 60; offset++) {
        const start = getWeekStart(offset, now);
        expectMidnightMonday(start);
        if (offset > 0) {
          // Nabouker er alltid nøyaktig én kalenderuke fra hverandre.
          expect(ymd(addDays(start, 7))).toBe(ymd(getWeekStart(offset - 1, now)));
        }
      }
    });
  });
});

describe("getMaxWeekOffset", () => {
  it("er 0 uten turer og for turer i inneværende uke", () => {
    const now = local(2025, 3, 12);
    expect(getMaxWeekOffset([], now)).toBe(0);
    expect(getMaxWeekOffset([{ startedAt: "2025-03-10T06:00:00+01:00" }], now)).toBe(0);
  });

  it("aldri negativ for turer i framtiden", () => {
    expect(getMaxWeekOffset([{ startedAt: "2025-04-10T06:00:00+02:00" }], local(2025, 3, 12))).toBe(0);
  });

  it("teller over årsskiftet med uke 53", () => {
    // Eldste tur i uke 52 (2020-12-21), now i uke 1 2021 → uke 52, 53, 1 = offset 2.
    const trips = [{ startedAt: "2021-01-05T08:00:00+01:00" }, { startedAt: "2020-12-22T08:00:00+01:00" }];
    expect(getMaxWeekOffset(trips, local(2021, 1, 6))).toBe(2);
  });

  it("teller over overgang til sommertid", () => {
    // Tur søndag 30. mars 2025 kl. 01:30 (før overgangen), now mandag 31. mars → én uke.
    expect(getMaxWeekOffset([{ startedAt: "2025-03-30T01:30:00+01:00" }], local(2025, 3, 31, 0, 30))).toBe(1);
  });

  it("teller over overgang til normaltid", () => {
    // Tur søndag 26. oktober 2025 kl. 23:30 (etter overgangen), now mandag 27. oktober → én uke.
    expect(getMaxWeekOffset([{ startedAt: "2025-10-26T23:30:00+01:00" }], local(2025, 10, 27, 0, 15))).toBe(1);
  });

  it("matcher getWeekStart: uka til eldste tur er getWeekStart(max)", () => {
    const now = local(2025, 11, 5);
    const trips = [{ startedAt: "2024-12-31T10:00:00+01:00" }];
    const max = getMaxWeekOffset(trips, now);
    expect(ymd(getWeekStart(max, now))).toBe("2024-12-30");
  });
});

describe("formatWeekRange", () => {
  it("samme måned", () => {
    expect(formatWeekRange(local(2025, 3, 10, 0))).toBe("10.–16. mars 2025");
  });

  it("over månedsskifte", () => {
    expect(formatWeekRange(local(2025, 3, 31, 0))).toBe("31. mars–6. apr. 2025");
  });

  it("over årsskifte viser bare sluttåret", () => {
    expect(formatWeekRange(local(2024, 12, 30, 0))).toBe("30. des.–5. jan. 2025");
  });
});
