"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { CreativeAdElement, CreativeWorkspace } from "../src/schemas";
import { ReferenceImageUploader } from "./ReferenceImageUploader";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

type CreativeDirectionChatProps = {
  runId: string;
  initialWorkspace?: CreativeWorkspace;
  suggestedAdElements?: CreativeAdElement[];
};

type CreativeAction = "elements" | "ask" | "message" | "concepts" | "approve";

type CreativeResponse = {
  workspace?: CreativeWorkspace;
  error?: string;
};

export function CreativeDirectionChat({
  runId,
  initialWorkspace,
  suggestedAdElements = []
}: CreativeDirectionChatProps) {
  const startingWorkspace = initialWorkspace ?? {
    status: suggestedAdElements.length > 0 ? "elements_ready" : "not_started",
    messages: [],
    adElements: suggestedAdElements,
    elementsApproved: false
  };
  const [workspace, setWorkspace] = useState<CreativeWorkspace>(
    startingWorkspace
  );
  const [elementDrafts, setElementDrafts] = useState<CreativeAdElement[]>(
    startingWorkspace.adElements ?? suggestedAdElements
  );
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>(
    startingWorkspace.referenceImageUrls ?? []
  );
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState<CreativeAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const promptsReady = workspace.status === "prompts_ready" && Boolean(workspace.generatedPrompts?.length);
  const elementsReady =
    Boolean(workspace.elementsApproved) ||
    workspace.status === "concepts_ready" ||
    workspace.status === "prompts_ready";
  const canSaveElements = elementDrafts.some(
    (element) => element.selected && element.value.trim().length > 0
  );
  const approvedConcept = useMemo(
    () => workspace.concepts?.find((concept) => concept.id === workspace.approvedConceptId),
    [workspace.approvedConceptId, workspace.concepts]
  );

  async function saveElements() {
    setError(null);
    setBusyAction("elements");

    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/creative`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "elements",
          referenceImageUrls,
          adElements: elementDrafts
            .map((element) => ({
              ...element,
              value: element.value.trim()
            }))
            .filter((element) => element.value.length > 0)
        })
      });
      const payload = (await response.json().catch(() => ({}))) as CreativeResponse;

      if (!response.ok || !payload.workspace) {
        throw new Error(payload.error ?? "Unable to approve ad elements.");
      }

      setWorkspace(payload.workspace);
      setElementDrafts(payload.workspace.adElements ?? []);
      setReferenceImageUrls(payload.workspace.referenceImageUrls ?? referenceImageUrls);
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Unable to approve ad elements."
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function sendAction(action: CreativeAction, conceptId?: string) {
    setError(null);
    setBusyAction(action);

    try {
      const body =
        action === "approve"
          ? { action, conceptId, referenceImageUrls }
          : action === "message"
            ? { action, message, referenceImageUrls }
            : { action, referenceImageUrls };
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/creative`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json().catch(() => ({}))) as CreativeResponse;

      if (!response.ok || !payload.workspace) {
        throw new Error(payload.error ?? "Unable to continue creative direction.");
      }

      setWorkspace(payload.workspace);
      setElementDrafts(payload.workspace.adElements ?? elementDrafts);
      setReferenceImageUrls(payload.workspace.referenceImageUrls ?? referenceImageUrls);

      if (action === "message") {
        setMessage("");
      }
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to continue creative direction."
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="space-y-4 rounded-md border bg-background p-5" aria-label="Creative chat">
        <div className="rounded-md border bg-muted/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Ad creative elements</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                The agent found these from the scrape and brief. Keep only the elements that
                should influence the ad creative before asking for angles.
              </p>
            </div>
            {elementsReady ? (
              <span className="rounded-full border border-green-700/20 bg-green-50 px-3 py-1 text-xs font-medium text-green-800">
                Ad elements approved
              </span>
            ) : null}
          </div>

          {elementDrafts.length > 0 ? (
            <div className="mt-4 space-y-3">
              {elementDrafts.map((element, index) => (
                <div key={element.id} className="grid gap-2 rounded-md border bg-background p-3 md:grid-cols-[180px_minmax(0,1fr)]">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      aria-label={element.label}
                      checked={element.selected}
                      onChange={(event) => {
                        const next = [...elementDrafts];
                        next[index] = { ...element, selected: event.target.checked };
                        setElementDrafts(next);
                      }}
                    />
                    <span>{element.label}</span>
                  </label>
                  <Input
                    aria-label={`${element.label} value`}
                    value={element.value}
                    onChange={(event) => {
                      const next = [...elementDrafts];
                      next[index] = { ...element, value: event.target.value };
                      setElementDrafts(next);
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              No scrape-derived ad elements were found. Add direction in chat, then generate
              creative angles.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={busyAction !== null || !canSaveElements}
              onClick={() => void saveElements()}
            >
              {busyAction === "elements" ? "Saving elements" : "Approve selected elements"}
            </Button>
            {!elementsReady ? (
              <p className="text-sm text-muted-foreground">
                Approve these first so the agent uses your selected ad ingredients.
              </p>
            ) : null}
          </div>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Chat with the creative agent</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Let the agent ask clarifying questions, then generate creative angles. Approve one
            angle to create the prompts used on Review.
          </p>
        </div>

        <div className="space-y-3">
          {workspace.messages.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Start by asking the agent what it still needs. Add details about the property look,
              reference images, tone, and campaign angle when you have them.
            </div>
          ) : (
            workspace.messages.map((chatMessage, index) => (
              <article
                key={`${chatMessage.createdAt}-${index}`}
                className={[
                  "rounded-md border p-4 text-sm leading-6",
                  chatMessage.role === "assistant" ? "bg-muted/30" : "bg-background"
                ].join(" ")}
              >
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {chatMessage.role === "assistant" ? "Agent" : "You"}
                </p>
                <p className="whitespace-pre-wrap">{chatMessage.content}</p>
              </article>
            ))
          )}
        </div>

        <label className="block space-y-2 text-sm font-medium">
          <span>Your answer or direction</span>
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="min-h-28"
            placeholder="Example: Use a twilight exterior, premium family energy, patriotic sky hook, no brand names."
          />
        </label>

        <ReferenceImageUploader
          runId={runId}
          label="Reference images for creative agent"
          value={referenceImageUrls}
          onChange={setReferenceImageUrls}
        />

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            className="border bg-background text-foreground hover:bg-muted"
            disabled={busyAction !== null || !elementsReady}
            onClick={() => void sendAction(message.trim() ? "message" : "ask")}
          >
            {busyAction === "ask" || busyAction === "message" ? "Thinking" : "Ask the agent"}
          </Button>
          <Button
            type="button"
            disabled={busyAction !== null || !elementsReady}
            onClick={() => void sendAction("concepts")}
          >
            {busyAction === "concepts" ? "Creating angles" : "Generate creative angles"}
          </Button>
        </div>

        {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
      </section>

      <aside className="space-y-4">
        <section className="rounded-md border bg-background p-4">
          <h2 className="text-base font-semibold">Creative angles</h2>
          {workspace.concepts?.length ? (
            <div className="mt-3 space-y-3">
              {workspace.concepts.map((concept) => (
                <article key={concept.id} className="rounded-md border p-3">
                  <h3 className="text-sm font-semibold">{concept.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {concept.description}
                  </p>
                  {concept.heroVisual ? (
                    <ConceptDetail label="Hero visual" value={concept.heroVisual} />
                  ) : null}
                  {concept.adStructure ? (
                    <ConceptDetail label="Ad structure" value={concept.adStructure} />
                  ) : null}
                  {concept.approvedElementsUsed?.length ? (
                    <ConceptList
                      label="Approved elements used"
                      values={concept.approvedElementsUsed}
                    />
                  ) : null}
                  {concept.avoid?.length ? (
                    <ConceptList label="Avoid" values={concept.avoid} />
                  ) : null}
                  <Button
                    type="button"
                    className="mt-3 w-full"
                    disabled={busyAction !== null || workspace.approvedConceptId === concept.id}
                    onClick={() => void sendAction("approve", concept.id)}
                  >
                    {workspace.approvedConceptId === concept.id ? "Approved" : "Approve angle"}
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Generate angles after the agent has enough context.
            </p>
          )}
        </section>

        <section className="rounded-md border bg-background p-4">
          <h2 className="text-base font-semibold">Next step</h2>
          {approvedConcept ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Approved: <span className="font-medium text-foreground">{approvedConcept.title}</span>
            </p>
          ) : null}
          {workspace.generatedPrompts?.length ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {workspace.generatedPrompts.length} prompts ready for Review.
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Approve an angle before continuing.
            </p>
          )}

          {promptsReady ? (
            <Link
              className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              href={`/review?runId=${encodeURIComponent(runId)}`}
            >
              Continue to Review
            </Link>
          ) : (
            <Button type="button" className="mt-4 w-full" disabled>
              Continue to Review
            </Button>
          )}
        </section>
      </aside>
    </div>
  );
}

function ConceptDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 rounded-md border bg-muted/20 p-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">{value}</p>
    </div>
  );
}

function ConceptList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="mt-3 rounded-md border bg-muted/20 p-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <ul className="mt-1 space-y-1 text-sm leading-5 text-muted-foreground">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  );
}
