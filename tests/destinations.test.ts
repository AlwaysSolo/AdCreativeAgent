import { inferDestination } from "../src/lib/destinations";

describe("destination inference", () => {
  it("uses the city from a scraped location as the destination", () => {
    expect(
      inferDestination({
        location: "Orlando, FL",
        headline: "4th of July Vacation Packages"
      })
    ).toEqual({
      destinationName: "Orlando",
      destinationSlug: "orlando"
    });
  });

  it("keeps multi-word destinations readable", () => {
    expect(
      inferDestination({
        location: "Las Vegas, NV",
        headline: "4th of July Vacation Packages"
      })
    ).toEqual({
      destinationName: "Las Vegas",
      destinationSlug: "las-vegas"
    });
  });

  it("falls back to known destination text in the landing page URL", () => {
    expect(
      inferDestination(
        {
          location: null,
          headline: "Summer vacation package"
        },
        "https://www.westgatereservations.com/specials/orlando-4th-of-july-vacation-package/"
      )
    ).toEqual({
      destinationName: "Orlando",
      destinationSlug: "orlando"
    });
  });
});
