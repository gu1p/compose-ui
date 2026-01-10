<script lang="ts">
  import { onMount } from "svelte";
  import FilterDrawer from "./components/FilterDrawer.svelte";
  import LayoutShell from "./components/LayoutShell.svelte";
  import PanelGrid from "./components/PanelGrid.svelte";
  import ServicesPanel from "./components/ServicesPanel.svelte";
  import SplitLayout from "./components/SplitLayout.svelte";
  import TopBar from "./components/TopBar.svelte";
  import {
    HISTORY_LIMIT,
    MAX_LINES_PER_PANEL,
    URL_SYNC_DELAY,
  } from "./lib/constants";
  import { buildPanelMeta, entryMatchesPanel } from "./lib/filters";
  import type { LogEvent, PanelConfig, PanelState, ServiceInfo } from "./lib/types";
  import { buildSearchString, readStateFromUrl, serializePanelsConfig } from "./lib/url-state";

  type AppState = {
    services: ServiceInfo[];
    panels: PanelState[];
    activePanelId: string | null;
    history: LogEvent[];
  };

  const appState: AppState = $state({
    services: [],
    panels: [],
    activePanelId: null,
    history: [],
  });

  let panelCounter = 0;
  let pendingUrlSync: ReturnType<typeof setTimeout> | null = null;
  let lastUrlSignature = "";
  let isRestoring = false;
  let drawerPanel: PanelState | null = $state(null);
  let loadError: string | null = $state(null);
  let eventStream: EventSource | null = null;

  const drawerOpen = $derived.by(() => drawerPanel !== null);
  const activePanel = $derived.by(() => {
    if (!appState.activePanelId && appState.panels.length) {
      return appState.panels[0];
    }
    return appState.panels.find((panel) => panel.id === appState.activePanelId) ?? null;
  });

  function setActivePanel(panelId: string) {
    const changed = appState.activePanelId !== panelId;
    appState.activePanelId = panelId;
    if (changed) {
      scheduleUrlSync();
    }
  }

  function getActivePanelIndex(): number | null {
    if (!appState.activePanelId) {
      return null;
    }
    const index = appState.panels.findIndex((panel) => panel.id === appState.activePanelId);
    if (index < 0) {
      return null;
    }
    return index;
  }

  function syncUrlWithState() {
    if (isRestoring) {
      return;
    }
    const panelsValue = serializePanelsConfig(appState.panels);
    const activeIndex = getActivePanelIndex();
    const nextSignature = `${panelsValue}|${activeIndex ?? ""}`;
    if (nextSignature === lastUrlSignature) {
      return;
    }
    lastUrlSignature = nextSignature;
    const search = buildSearchString(panelsValue, activeIndex);
    const nextUrl = `${window.location.pathname}${search}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }

  function scheduleUrlSync() {
    if (isRestoring) {
      return;
    }
    if (pendingUrlSync) {
      clearTimeout(pendingUrlSync);
    }
    pendingUrlSync = setTimeout(() => {
      pendingUrlSync = null;
      syncUrlWithState();
    }, URL_SYNC_DELAY);
  }

  function rebuildPanelLogs(panel: PanelState) {
    panel.logs = appState.history
      .filter((entry) => entryMatchesPanel(panel, entry))
      .slice(-MAX_LINES_PER_PANEL);
  }

  function applyPanelConfig(panel: PanelState, config: PanelConfig) {
    panel.filter = config.services && config.services.length ? [...config.services] : null;
    panel.include = [...(config.include ?? [])];
    panel.exclude = [...(config.exclude ?? [])];
    panel.autoScroll = config.follow !== false;
    rebuildPanelLogs(panel);
  }

  function createPanel(config?: PanelConfig): PanelState {
    panelCounter += 1;
    const panel: PanelState = {
      id: `panel-${panelCounter}`,
      title: `Panel ${panelCounter}`,
      filter: null,
      include: [],
      exclude: [],
      autoScroll: true,
      logs: [],
      delay: Math.min(panelCounter * 0.05, 0.3),
    };
    appState.panels.push(panel);
    if (!appState.activePanelId) {
      appState.activePanelId = panel.id;
    }
    if (config) {
      applyPanelConfig(panel, config);
    } else {
      rebuildPanelLogs(panel);
    }
    scheduleUrlSync();
    return panel;
  }

  function restorePanelsFromUrl(): boolean {
    const urlState = readStateFromUrl();
    if (!urlState.panels || !urlState.panels.length) {
      return false;
    }
    isRestoring = true;
    appState.panels = [];
    appState.activePanelId = null;
    panelCounter = 0;
    urlState.panels.forEach((config) => {
      createPanel(config);
    });
    if (urlState.activeIndex !== null && appState.panels[urlState.activeIndex]) {
      appState.activePanelId = appState.panels[urlState.activeIndex].id;
    }
    isRestoring = false;
    scheduleUrlSync();
    return true;
  }

  function toggleService(panel: PanelState, serviceName: string) {
    if (panel.filter === null) {
      panel.filter = [serviceName];
    } else if (panel.filter.includes(serviceName)) {
      panel.filter = panel.filter.filter((name) => name !== serviceName);
      if (panel.filter.length === 0) {
        panel.filter = null;
      }
    } else {
      panel.filter = [...panel.filter, serviceName];
    }
    rebuildPanelLogs(panel);
    scheduleUrlSync();
  }

  function setAllServices(panel: PanelState) {
    panel.filter = null;
    rebuildPanelLogs(panel);
    scheduleUrlSync();
  }

  function updatePanelFilters(panel: PanelState, include: string[], exclude: string[]) {
    panel.include = [...include];
    panel.exclude = [...exclude];
    rebuildPanelLogs(panel);
    scheduleUrlSync();
  }

  function handleServiceSelect(service: ServiceInfo) {
    const panel = activePanel ?? createPanel();
    panel.filter = [service.name];
    rebuildPanelLogs(panel);
    scheduleUrlSync();
  }

  function closePanel(panel: PanelState) {
    if (appState.panels.length <= 1) {
      return;
    }
    const index = appState.panels.findIndex((item) => item.id === panel.id);
    if (index < 0) {
      return;
    }
    appState.panels.splice(index, 1);
    if (appState.activePanelId === panel.id) {
      appState.activePanelId = appState.panels[0]?.id ?? null;
    }
    if (drawerPanel?.id === panel.id) {
      drawerPanel = null;
    }
    scheduleUrlSync();
  }

  function toggleFollow(panel: PanelState) {
    panel.autoScroll = !panel.autoScroll;
    scheduleUrlSync();
  }

  function openFilterDrawer(panel: PanelState) {
    drawerPanel = panel;
  }

  function closeFilterDrawer() {
    drawerPanel = null;
  }

  function handleDrawerUpdate(include: string[], exclude: string[]) {
    if (!drawerPanel) {
      return;
    }
    updatePanelFilters(drawerPanel, include, exclude);
  }

  function handleLogEvent(entry: LogEvent) {
    appState.history.push(entry);
    if (appState.history.length > HISTORY_LIMIT) {
      appState.history.shift();
    }
    appState.panels.forEach((panel) => {
      if (entryMatchesPanel(panel, entry)) {
        panel.logs.push(entry);
        while (panel.logs.length > MAX_LINES_PER_PANEL) {
          panel.logs.shift();
        }
      }
    });
  }

  function startEventStream() {
    eventStream = new EventSource("/events");
    eventStream.addEventListener("history", (event) => {
      try {
        const entries = JSON.parse((event as MessageEvent).data);
        if (Array.isArray(entries)) {
          appState.history = entries.slice(-HISTORY_LIMIT);
          appState.panels.forEach((panel) => rebuildPanelLogs(panel));
        }
      } catch (error) {
        console.error(error);
      }
    });
    eventStream.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as LogEvent;
        handleLogEvent(entry);
      } catch (error) {
        console.error(error);
      }
    };
  }

  async function init() {
    try {
      const response = await fetch("/api/services");
      const payload = await response.json();
      appState.services = payload.services ?? [];
      if (!restorePanelsFromUrl()) {
        createPanel();
      }
      startEventStream();
    } catch (error) {
      loadError = "Failed to load services.";
      console.error(error);
    }
  }

  onMount(() => {
    init();
    return () => {
      eventStream?.close();
    };
  });
</script>

<LayoutShell {drawerOpen}>
  {#snippet header()}
    <TopBar onAddPanel={createPanel} />
  {/snippet}

  <SplitLayout>
    {#snippet sidebar()}
      <ServicesPanel services={appState.services} error={loadError} onSelect={handleServiceSelect} />
    {/snippet}
    {#snippet content()}
      <PanelGrid
        panels={appState.panels}
        services={appState.services}
        activePanelId={appState.activePanelId}
        onActivate={setActivePanel}
        onToggleFollow={toggleFollow}
        onOpenFilters={openFilterDrawer}
        onClose={closePanel}
        onToggleService={toggleService}
        onSelectAll={setAllServices}
      />
    {/snippet}
  </SplitLayout>
</LayoutShell>

<FilterDrawer
  open={drawerOpen}
  panel={drawerPanel}
  meta={drawerPanel ? buildPanelMeta(drawerPanel) : ""}
  onClose={closeFilterDrawer}
  onUpdate={handleDrawerUpdate}
/>
