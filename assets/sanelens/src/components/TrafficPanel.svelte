<script lang="ts">
  import type { EdgeKey, EntityId, TrafficEdge } from "../lib/types";

  type TrafficPanelProps = {
    edges?: TrafficEdge[];
    error?: string | null;
  };

  let { edges = [], error = null }: TrafficPanelProps = $props();

  function edgeId(edge: TrafficEdge) {
    return JSON.stringify(edge.key);
  }

  function entityLabel(entity: EntityId) {
    switch (entity.kind) {
      case "workload":
        return entity.name;
      case "external":
        return entity.dns_name ?? entity.ip;
      case "host":
        return entity.name;
      default:
        return "unknown";
    }
  }

  function edgeTitle(edge: TrafficEdge) {
    const from = entityLabel(edge.key.from);
    const to = entityLabel(edge.key.to);
    return `${from} -> ${to}`;
  }

  function edgeDetail(key: EdgeKey) {
    if (key.kind === "http") {
      return `${key.method} ${key.route}`;
    }
    if (key.kind === "grpc") {
      return `${key.service}/${key.method}`;
    }
    if (key.kind === "flow") {
      return `${key.transport.kind.toUpperCase()} :${key.port}`;
    }
    return "";
  }

  function formatLatency(value?: number | null) {
    if (value === null || value === undefined) {
      return "—";
    }
    return `${value}ms`;
  }
</script>

<div class="rounded-3xl border border-ink/10 bg-panel/70 p-4 shadow-[var(--shadow)]">
  <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <div class="text-xs uppercase tracking-[0.12em] text-muted">Traffic</div>
      <div class="text-lg font-semibold">Live calls</div>
    </div>
    <div class="text-xs text-muted">{edges.length} edges</div>
  </div>

  {#if error}
    <div class="mt-3 text-sm text-muted">{error}</div>
  {:else if edges.length === 0}
    <div class="mt-3 text-sm text-muted">No traffic captured yet.</div>
  {:else}
    <div class="mt-3 max-h-64 overflow-auto rounded-2xl border border-ink/10 bg-panel/60">
      <div class="divide-y divide-ink/10">
        {#each edges as edge (edgeId(edge))}
          <div class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold">{edgeTitle(edge)}</div>
              <div class="truncate text-xs text-muted">{edgeDetail(edge.key)}</div>
            </div>
            <div class="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span>{edge.stats.count} calls</span>
              <span>p95 {formatLatency(edge.stats.p95_ms)}</span>
              {#if edge.stats.errors > 0}
                <span class="text-accent">{edge.stats.errors} errors</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
