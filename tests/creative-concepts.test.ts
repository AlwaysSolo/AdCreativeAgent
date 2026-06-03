import { parseCreativeConcepts } from "../src/lib/creative-concepts";

describe("creative concept parsing", () => {
  it("parses complete JSON angles without splitting one angle into continuations", () => {
    const concepts = parseCreativeConcepts(
      JSON.stringify({
        concepts: [
          {
            title: "Firework Price Stage",
            concept: "A direct-response layout where the offer sits in the visual spotlight.",
            heroVisual: "A bright patriotic sky glow above an Orlando pool scene.",
            adStructure: "Large price hierarchy, duration banner, and destination-led headline.",
            approvedElementsUsed: ["Destination: Orlando", "Offer / price: from $99"],
            avoid: ["No logo", "No extra family taglines"]
          },
          {
            title: "Poolside Celebration",
            concept:
              "A separate angle focused on the pool foreground, not a continuation of the first option.",
            heroVisual: "Guests at pool level with red and blue reflections in the water.",
            adStructure: "Headline at top, price burst center, small holiday badge.",
            approvedElementsUsed: ["Promotion / theme: July 4th"],
            avoid: ["No CTA because it was not approved"]
          }
        ]
      })
    );

    expect(concepts).toHaveLength(2);
    expect(concepts[0]).toMatchObject({
      id: "concept-1",
      title: "Firework Price Stage",
      heroVisual: "A bright patriotic sky glow above an Orlando pool scene.",
      approvedElementsUsed: ["Destination: Orlando", "Offer / price: from $99"]
    });
    expect(concepts[1]).toMatchObject({
      id: "concept-2",
      title: "Poolside Celebration",
      avoid: ["No CTA because it was not approved"]
    });
  });

  it("does not split unstructured commentary into fake angles", () => {
    const concepts = parseCreativeConcepts(
      [
        "The signature hook is a family fun patriotic atmosphere built around the pool.",
        "Concept 3 - Star Spangled Sky Arc is mentioned here as a continuation, but the agent did not return a complete structured angle.",
        "This whole response is commentary, not a set of usable angle objects."
      ].join("\n")
    );

    expect(concepts).toEqual([
      expect.objectContaining({
        id: "concept-1",
        title: "Creative Agent Concept"
      })
    ]);
  });
});
