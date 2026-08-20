"use client";

import { useCallback, useEffect, useState } from "react";
import { isAddress } from "viem";
import { GameBoyPlayer } from "@/components/player/game-boy-player";
import { PaidGameActions } from "@/components/PaidGameActions";
import { explorerAddress, shortHash } from "@/lib/explorer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type JobResult = {
  sha256?: string;
  extension?: string;
  quality?: string;
};

type GameStatusPayload = {
  game: {
    slug: string;
    title: string;
    description: string;
    creatorAddress: string;
    priceMon: string | null;
    rightsNote: string;
    bountyMon?: string;
    bountyTxHash?: string;
    bountyId?: string;
    bountyDeadline?: number;
  };
  job: {
    jobId: string;
    status: string;
    phase: string;
    progress: number;
    error: string | null;
    result?: JobResult;
  };
  publication: {
    published: boolean;
    creator: string;
    playPrice: string;
    bountyId: string;
    submissionId: number;
    purchaseCount: number;
    gameContentHash: string;
    metadataURI: string;
  } | null;
  viewer: {
    address: string | null;
    isCreator: boolean;
    hasAccess: boolean;
  };
  ready: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseJobResult(value: unknown): JobResult | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Job result is malformed.");
  return {
    sha256: asString(value.sha256),
    extension: asString(value.extension),
    quality: asString(value.quality),
  };
}

export function parsePublication(value: unknown): GameStatusPayload["publication"] {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error("Publication is malformed.");

  const published = asBoolean(value.published);
  const creator = asString(value.creator);
  const playPrice = asString(value.playPrice);
  const bountyId = asString(value.bountyId);
  const submissionId = asNumber(value.submissionId);
  const purchaseCount = asNumber(value.purchaseCount);
  const gameContentHash = asString(value.gameContentHash);
  const metadataURI = asString(value.metadataURI);
  if (
    published === undefined ||
    !creator ||
    playPrice === undefined ||
    !bountyId ||
    submissionId === undefined ||
    !Number.isInteger(submissionId) ||
    submissionId < 0 ||
    purchaseCount === undefined ||
    !Number.isInteger(purchaseCount) ||
    purchaseCount < 0 ||
    !gameContentHash ||
    metadataURI === undefined
  ) {
    throw new Error("Publication fields are malformed.");
  }
  if (!isAddress(creator)) throw new Error("Publication creator is malformed.");

  return {
    published,
    creator,
    playPrice,
    bountyId,
    submissionId,
    purchaseCount,
    gameContentHash,
    metadataURI,
  };
}

function parseStatus(value: unknown): GameStatusPayload {
  if (!isRecord(value)) throw new Error("Game status response is malformed.");

  const game = value.game;
  const job = value.job;
  const viewer = value.viewer;
  const ready = asBoolean(value.ready);
  if (!isRecord(game) || !isRecord(job) || !isRecord(viewer) || ready === undefined) {
    throw new Error("Game status response is missing required objects.");
  }

  const slug = asString(game.slug);
  const title = asString(game.title);
  const description = asString(game.description);
  const creatorAddress = asString(game.creatorAddress);
  const rightsNote = asString(game.rightsNote);
  const priceMon = game.priceMon === null ? null : asString(game.priceMon);
  if (!slug || !title || !description || !creatorAddress || !rightsNote || priceMon === undefined) {
    throw new Error("Game fields are malformed.");
  }
  if (!isAddress(creatorAddress)) throw new Error("Creator address is malformed.");

  const jobId = asString(job.jobId);
  const status = asString(job.status);
  const phase = asString(job.phase);
  const progress = asNumber(job.progress);
  const jobError = job.error === null ? null : asString(job.error);
  if (!jobId || !status || phase === undefined || progress === undefined || jobError === undefined) {
    throw new Error("Job fields are malformed.");
  }

  const hasAccess = asBoolean(viewer.hasAccess);
  const isCreator = asBoolean(viewer.isCreator);
  if (hasAccess === undefined || isCreator === undefined) {
    throw new Error("Viewer fields are malformed.");
  }

  const address = viewer.address === null ? null : asString(viewer.address);
  if (address === undefined) throw new Error("Viewer address is malformed.");
  if (address !== null && !isAddress(address)) {
    throw new Error("Authenticated address is malformed.");
  }

  const parsedGame: GameStatusPayload["game"] = {
    slug,
    title,
    description,
    creatorAddress,
    priceMon,
    rightsNote,
  };
  const bountyMon = asString(game.bountyMon);
  const bountyTxHash = asString(game.bountyTxHash);
  const bountyId = asString(game.bountyId);
  const bountyDeadline = asNumber(game.bountyDeadline);
  if (bountyMon && bountyTxHash && bountyId && bountyDeadline) {
    parsedGame.bountyMon = bountyMon;
    parsedGame.bountyTxHash = bountyTxHash;
    parsedGame.bountyId = bountyId;
    parsedGame.bountyDeadline = bountyDeadline;
  }

  return {
    game: parsedGame,
    job: {
      jobId,
      status,
      phase,
      progress,
      error: jobError,
      result: parseJobResult(job.result),
    },
    publication: parsePublication(value.publication),
    viewer: { address, isCreator, hasAccess },
    ready,
  };
}

function jobBadgeVariant(status: string): "default" | "secondary" | "warning" | "destructive" {
  if (status === "complete") return "default";
  if (status === "failed") return "destructive";
  if (status === "queued" || status === "running") return "warning";
  return "secondary";
}

export function GamePageClient({ slug }: { slug: string }) {
  const [payload, setPayload] = useState<GameStatusPayload | null>(null);
  const [error, setError] = useState<string>();
  const [shareNote, setShareNote] = useState<string>();
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [runId, setRunId] = useState(0);

  const loadStatus = useCallback(async () => {
    const response = await fetch(`/api/games/${encodeURIComponent(slug)}/status`, {
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(`Status request failed with ${response.status}.`);
    }
    return parseStatus(await response.json());
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function tick() {
      try {
        const next = await loadStatus();
        if (cancelled) return;
        setPayload(next);
        setError(undefined);
        if (next.job.status === "queued" || next.job.status === "running") {
          timer = window.setTimeout(() => {
            void tick();
          }, 4000);
        }
      } catch (caught) {
        if (cancelled) return;
        setPayload(null);
        setError(caught instanceof Error ? caught.message : "Unable to load game status.");
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadStatus]);

  const onAccessChanged = useCallback(() => {
    void loadStatus()
      .then((next) => {
        setPayload(next);
        setError(undefined);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to refresh game status.");
      });
  }, [loadStatus]);

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareNote("Share URL copied.");
    } catch {
      setShareNote("Copy the address bar to share this game.");
    }
  }

  if (error && !payload) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Game unavailable</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!payload) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading game</CardTitle>
          <CardDescription>Fetching reconstruction and access status.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const authenticated = payload.viewer.address !== null;
  const allowed = payload.viewer.hasAccess;
  const jobComplete = payload.job.status === "complete";
  const canPlay = payload.ready && jobComplete && allowed;
  const romUrl = `/api/games/${encodeURIComponent(payload.game.slug)}/rom`;
  const jobDetail = payload.job.error ? `${payload.job.phase}: ${payload.job.error}` : payload.job.phase;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <p className="kicker">Paid listing</p>
          <CardTitle>{payload.game.title}</CardTitle>
          <CardDescription>{payload.game.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p>
            Creator{" "}
            <a className="mono" href={explorerAddress(payload.game.creatorAddress)} rel="noreferrer" target="_blank">
              {shortHash(payload.game.creatorAddress)}
            </a>
          </p>
          <Button onClick={() => void share()} type="button" variant="secondary">
            Share
          </Button>
          <Button
            aria-controls="game-analysis"
            aria-expanded={showAnalysis}
            onClick={() => setShowAnalysis((visible) => !visible)}
            type="button"
            variant="outline"
          >
            {showAnalysis ? "Hide game analysis" : "View game analysis"}
          </Button>
          {shareNote ? <p className="note">{shareNote}</p> : null}
        </CardContent>
      </Card>

      {showAnalysis ? <Card id="game-analysis">
        <CardHeader>
          <p className="kicker">Reconstruction</p>
          <CardTitle>Job status</CardTitle>
          <CardDescription>{jobDetail}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Badge variant={jobBadgeVariant(payload.job.status)}>{payload.job.status}</Badge>
          <p className="note">Progress {payload.job.progress}%</p>
          {payload.job.result?.sha256 ? (
            <p className="note mono">sha256 {payload.job.result.sha256}</p>
          ) : null}
          {payload.job.result?.extension ? (
            <p className="note">extension {payload.job.result.extension}</p>
          ) : null}
          {payload.job.result?.quality ? (
            <p className="note">
              Result quality: {payload.job.result.quality === "approximate" ? "playable approximation" : payload.job.result.quality}
            </p>
          ) : null}
        </CardContent>
      </Card> : null}

      <Card>
        <CardHeader>
          <p className="kicker">Rights</p>
          <CardTitle>Distribution note</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{payload.game.rightsNote}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <p className="kicker">Price and access</p>
          <CardTitle>On-chain purchase</CardTitle>
          <CardDescription>
            Listed price {payload.game.priceMon ? `${payload.game.priceMon} MON` : "unset"}. Purchase uses the
            exact on-chain price after publish.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <PaidGameActions
            authenticatedAddress={payload.viewer.address ?? undefined}
            creatorAddress={payload.game.creatorAddress}
            initialBountyId={payload.game.bountyId}
            jobComplete={jobComplete}
            onAccessChanged={onAccessChanged}
            priceMon={payload.game.priceMon}
            resultSha256={payload.job.result?.sha256}
            slug={payload.game.slug}
          />
          {error ? <p className="field-error">{error}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <p className="kicker">Play</p>
          <CardTitle>{payload.game.title}</CardTitle>
        </CardHeader>
        <CardContent>
          {canPlay ? (
            <GameBoyPlayer
              key={runId}
              onRestart={() => setRunId((n) => n + 1)}
              romUrl={romUrl}
              title={payload.game.title}
            />
          ) : (
            <p className="note">
              {!payload.ready || !jobComplete
                ? "The ROM is not fetched until reconstruction is complete and access is allowed."
                : !authenticated
                  ? "Sign in with the connected wallet, then purchase access if you are not the creator."
                  : allowed
                    ? "Access is recorded, but the reconstruction job is not complete."
                    : "Purchase access or wait for the creator listing. The ROM is not requested until access is allowed."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
