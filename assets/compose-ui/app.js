const state = {
  services: [],
  panels: [],
  activePanelId: null,
  history: [],
};

const HISTORY_LIMIT = 20000;
const MAX_LINES_PER_PANEL = 8000;
const URL_STATE_KEY = "panels";
const URL_ACTIVE_KEY = "active";
const URL_SYNC_DELAY = 200;
const PANEL_SEPARATOR = "~";
const GROUP_SEPARATOR = ";";
const LIST_SEPARATOR = ",";

const palette = [
  "#e07a5f",
  "#3d405b",
  "#81b29a",
  "#f2cc8f",
  "#f4a261",
  "#2a9d8f",
  "#6d597a",
  "#f94144",
  "#8ecae6",
];

const serviceColors = new Map();
let panelCounter = 0;
let pendingUrlSync = null;
let lastUrlSignature = "";
let isRestoringState = false;

const panelsEl = document.getElementById("panels");
const serviceListEl = document.getElementById("service-list");
const addPanelBtn = document.getElementById("add-panel");
const panelTemplate = document.getElementById("panel-template");
const filterDrawer = document.getElementById("filter-drawer");
const filterDrawerTitle = document.getElementById("filter-drawer-title");
const filterDrawerSubtitle = document.getElementById("filter-drawer-subtitle");
const filterIncludeList = document.querySelector("[data-filter-list='include']");
const filterExcludeList = document.querySelector("[data-filter-list='exclude']");
const filterClearBtn = document.getElementById("filter-clear");
const filterDoneBtn = document.getElementById("filter-done");

const filterLists = {
  include: filterIncludeList,
  exclude: filterExcludeList,
};

let drawerPanel = null;

function colorFor(service) {
  if (!serviceColors.has(service)) {
    const color = palette[serviceColors.size % palette.length];
    serviceColors.set(service, color);
  }
  return serviceColors.get(service);
}

function getEndpoints(service) {
  if (Array.isArray(service.endpoints) && service.endpoints.length) {
    return service.endpoints;
  }
  if (service.endpoint) {
    return [service.endpoint];
  }
  return [];
}

function endpointLabel(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.host;
  } catch (error) {
    return endpoint.replace("http://", "");
  }
}

function setActivePanel(panelId) {
  const changed = state.activePanelId !== panelId;
  state.activePanelId = panelId;
  state.panels.forEach((panel) => {
    panel.el.classList.toggle("is-active", panel.id === panelId);
  });
  if (changed) {
    scheduleUrlSync();
  }
}

function getActivePanel() {
  if (!state.activePanelId && state.panels.length) {
    return state.panels[0];
  }
  return state.panels.find((panel) => panel.id === state.activePanelId) || null;
}

function updatePanelMeta(panel) {
  let label = "ALL SERVICES";
  if (panel.filter && panel.filter.size === 1) {
    label = [...panel.filter][0].toUpperCase();
  } else if (panel.filter && panel.filter.size > 1) {
    label = `${panel.filter.size} SERVICES`;
  }
  const includeCount = panel.textFilters?.include?.length || 0;
  const excludeCount = panel.textFilters?.exclude?.length || 0;
  const parts = [label];
  if (includeCount) {
    parts.push(`+${includeCount} include`);
  }
  if (excludeCount) {
    parts.push(`-${excludeCount} exclude`);
  }
  panel.metaEl.textContent = parts.join(" | ");
}

function updatePanelChips(panel) {
  if (panel.filter === null) {
    panel.allChip.classList.add("is-active");
  } else {
    panel.allChip.classList.remove("is-active");
  }
  panel.chipButtons.forEach((button, name) => {
    const active = panel.filter && panel.filter.has(name);
    button.classList.toggle("is-active", Boolean(active));
  });
  updatePanelMeta(panel);
}

function updateFollowState(panel) {
  if (!panel.followBtn) {
    return;
  }
  panel.followBtn.textContent = panel.autoScroll ? "Follow" : "Paused";
  panel.followBtn.classList.toggle("chip-muted", !panel.autoScroll);
  panel.followBtn.classList.toggle("is-active", panel.autoScroll);
}

function createLogLine(entry) {
  const lineEl = document.createElement("div");
  lineEl.className = "log-line";

  const serviceEl = document.createElement("span");
  serviceEl.className = "log-service";
  serviceEl.textContent = entry.service;
  serviceEl.style.setProperty("--chip-color", colorFor(entry.service));

  const tsEl = document.createElement("span");
  tsEl.className = "log-ts";
  tsEl.textContent = entry.container_ts || "";

  const textEl = document.createElement("span");
  textEl.className = "log-text";
  textEl.textContent = entry.line;

  lineEl.appendChild(serviceEl);
  lineEl.appendChild(tsEl);
  lineEl.appendChild(textEl);
  return lineEl;
}

function normalizeFilterToken(value) {
  if (!value) {
    return "";
  }
  return value.trim().toLowerCase();
}

function normalizeServiceToken(value) {
  if (!value) {
    return "";
  }
  return value.trim();
}

function encodeToken(value) {
  return encodeURIComponent(value).replace(/~/g, "%7E");
}

function decodeToken(value) {
  if (!value) {
    return "";
  }
  const sanitized = value.replace(/\+/g, " ");
  try {
    return decodeURIComponent(sanitized);
  } catch (error) {
    return sanitized;
  }
}

function encodeTokenList(tokens) {
  return tokens.map((token) => encodeToken(token)).join(LIST_SEPARATOR);
}

function decodeTokenList(value, normalizer = normalizeServiceToken) {
  if (!value) {
    return [];
  }
  return value
    .split(LIST_SEPARATOR)
    .map((token) => decodeToken(token))
    .map((token) => normalizer(token))
    .filter(Boolean);
}

function readFilterList(listEl) {
  if (!listEl) {
    return [];
  }
  return [...listEl.querySelectorAll("input")]
    .map((input) => normalizeFilterToken(input.value))
    .filter(Boolean);
}

function createFilterRow(type, value = "") {
  const row = document.createElement("div");
  row.className = "filter-row";
  row.dataset.filter = type;

  const input = document.createElement("input");
  input.className = "panel-text-input";
  input.type = "text";
  input.placeholder = type === "include" ? "error" : "healthcheck";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", type === "include" ? "Include filter" : "Exclude filter");
  input.value = value;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "chip chip-small chip-ghost remove-filter";
  removeBtn.textContent = "x";
  removeBtn.setAttribute("aria-label", "Remove filter");
  removeBtn.title = "Remove filter";

  row.appendChild(input);
  row.appendChild(removeBtn);
  return row;
}

function renderFilterList(type, values) {
  const listEl = filterLists[type];
  listEl.innerHTML = "";
  values.forEach((value) => {
    listEl.appendChild(createFilterRow(type, value));
  });
  if (!listEl.children.length) {
    listEl.appendChild(createFilterRow(type));
  }
}

function getRawQueryParam(name) {
  const query = window.location.search.slice(1);
  if (!query) {
    return null;
  }
  const pairs = query.split("&");
  for (const pair of pairs) {
    if (!pair) {
      continue;
    }
    const [key, ...rest] = pair.split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return null;
}

function serializePanelConfig(panel) {
  const parts = [];
  const services = panel.filter ? [...panel.filter] : [];
  if (!panel.filter || services.length === 0) {
    parts.push("svc=all");
  } else {
    parts.push(`svc=${encodeTokenList(services)}`);
  }
  const includeTokens = panel.textFilters?.include?.filter(Boolean) || [];
  if (includeTokens.length) {
    parts.push(`inc=${encodeTokenList(includeTokens)}`);
  }
  const excludeTokens = panel.textFilters?.exclude?.filter(Boolean) || [];
  if (excludeTokens.length) {
    parts.push(`exc=${encodeTokenList(excludeTokens)}`);
  }
  if (!panel.autoScroll) {
    parts.push("follow=0");
  }
  return parts.join(GROUP_SEPARATOR);
}

function serializePanelsConfig(panels) {
  if (!panels.length) {
    return "";
  }
  return panels.map((panel) => serializePanelConfig(panel)).join(PANEL_SEPARATOR);
}

function parsePanelConfig(raw) {
  const config = {
    services: null,
    include: [],
    exclude: [],
    follow: true,
  };
  if (!raw) {
    return config;
  }
  raw.split(GROUP_SEPARATOR).forEach((part) => {
    if (!part) {
      return;
    }
    const [key, ...rest] = part.split("=");
    const value = rest.join("=");
    if (key === "svc") {
      if (!value || value === "all") {
        config.services = null;
        return;
      }
      const services = decodeTokenList(value, normalizeServiceToken);
      config.services = services.length ? services : null;
      return;
    }
    if (key === "inc") {
      config.include = decodeTokenList(value, normalizeFilterToken);
      return;
    }
    if (key === "exc") {
      config.exclude = decodeTokenList(value, normalizeFilterToken);
      return;
    }
    if (key === "follow") {
      config.follow = value !== "0";
    }
  });
  return config;
}

function parsePanelsConfig(raw) {
  if (!raw) {
    return null;
  }
  return raw
    .split(PANEL_SEPARATOR)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parsePanelConfig(entry));
}

function getActivePanelIndex() {
  if (!state.activePanelId) {
    return null;
  }
  const index = state.panels.findIndex((panel) => panel.id === state.activePanelId);
  if (index < 0) {
    return null;
  }
  return index;
}

function buildSearchString(panelsValue, activeIndex) {
  const params = new URLSearchParams(window.location.search);
  params.delete(URL_STATE_KEY);
  params.delete(URL_ACTIVE_KEY);
  const parts = [];
  const base = params.toString();
  if (base) {
    parts.push(base);
  }
  if (panelsValue) {
    parts.push(`${URL_STATE_KEY}=${panelsValue}`);
  }
  if (activeIndex !== null) {
    parts.push(`${URL_ACTIVE_KEY}=${activeIndex + 1}`);
  }
  if (!parts.length) {
    return "";
  }
  return `?${parts.join("&")}`;
}

function syncUrlWithState() {
  if (isRestoringState) {
    return;
  }
  const panelsValue = serializePanelsConfig(state.panels);
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
  if (isRestoringState) {
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

function parseActiveIndex(rawValue, panelCount) {
  if (!rawValue) {
    return null;
  }
  const decoded = decodeToken(rawValue);
  const parsed = Number.parseInt(decoded, 10);
  if (Number.isNaN(parsed)) {
    return null;
  }
  const index = parsed - 1;
  if (index < 0) {
    return null;
  }
  if (typeof panelCount === "number" && index >= panelCount) {
    return null;
  }
  return index;
}

function readStateFromUrl() {
  const rawPanels = getRawQueryParam(URL_STATE_KEY);
  const rawActive = getRawQueryParam(URL_ACTIVE_KEY);
  const panels = rawPanels ? parsePanelsConfig(rawPanels) : null;
  const activeIndex = parseActiveIndex(rawActive, panels?.length);
  return { panels, activeIndex };
}

function applyPanelConfig(panel, config) {
  if (!panel || !config) {
    return;
  }
  if (config.services && config.services.length) {
    panel.filter = new Set(config.services);
  } else {
    panel.filter = null;
  }
  panel.textFilters.include = [...(config.include || [])];
  panel.textFilters.exclude = [...(config.exclude || [])];
  panel.autoScroll = config.follow !== false;
  updatePanelChips(panel);
  updateFollowState(panel);
  renderPanelLogs(panel);
}

function restorePanelsFromUrl() {
  const urlState = readStateFromUrl();
  if (!urlState.panels || !urlState.panels.length) {
    return false;
  }
  isRestoringState = true;
  panelsEl.innerHTML = "";
  state.panels = [];
  state.activePanelId = null;
  panelCounter = 0;
  urlState.panels.forEach((config) => {
    const panel = createPanel();
    applyPanelConfig(panel, config);
  });
  if (urlState.activeIndex !== null && state.panels[urlState.activeIndex]) {
    setActivePanel(state.panels[urlState.activeIndex].id);
  }
  isRestoringState = false;
  scheduleUrlSync();
  return true;
}

function entryMatchesPanel(panel, entry) {
  if (panel.filter && !panel.filter.has(entry.service)) {
    return false;
  }
  const includeTokens = panel.textFilters?.include || [];
  const excludeTokens = panel.textFilters?.exclude || [];
  if (includeTokens.length === 0 && excludeTokens.length === 0) {
    return true;
  }
  const normalizedLine = String(entry.line).toLowerCase();
  if (includeTokens.length && !includeTokens.some((token) => normalizedLine.includes(token))) {
    return false;
  }
  if (excludeTokens.length && excludeTokens.some((token) => normalizedLine.includes(token))) {
    return false;
  }
  return true;
}

function syncPanelFiltersFromDrawer() {
  if (!drawerPanel) {
    return;
  }
  drawerPanel.textFilters.include = readFilterList(filterIncludeList);
  drawerPanel.textFilters.exclude = readFilterList(filterExcludeList);
  updatePanelMeta(drawerPanel);
  filterDrawerSubtitle.textContent = drawerPanel.metaEl.textContent;
  renderPanelLogs(drawerPanel);
  scheduleUrlSync();
}

function openFilterDrawer(panel) {
  drawerPanel = panel;
  renderFilterList("include", panel.textFilters.include);
  renderFilterList("exclude", panel.textFilters.exclude);
  filterDrawerTitle.textContent = `${panel.titleEl.textContent} filters`;
  filterDrawerSubtitle.textContent = panel.metaEl.textContent;
  filterDrawer.classList.add("is-open");
  filterDrawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("drawer-open");
  const firstInput = filterIncludeList.querySelector("input");
  if (firstInput) {
    firstInput.focus();
  }
}

function closeFilterDrawer() {
  filterDrawer.classList.remove("is-open");
  filterDrawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("drawer-open");
  drawerPanel = null;
}

function renderPanelLogs(panel) {
  panel.logEl.innerHTML = "";
  const fragment = document.createDocumentFragment();
  state.history.forEach((entry) => {
    if (entryMatchesPanel(panel, entry)) {
      fragment.appendChild(createLogLine(entry));
    }
  });
  panel.logEl.appendChild(fragment);
  if (panel.autoScroll) {
    panel.logEl.scrollTop = panel.logEl.scrollHeight;
  }
}

function appendLogLine(panel, entry) {
  panel.logEl.appendChild(createLogLine(entry));
  while (panel.logEl.children.length > MAX_LINES_PER_PANEL) {
    panel.logEl.removeChild(panel.logEl.firstChild);
  }
  if (panel.autoScroll) {
    panel.logEl.scrollTop = panel.logEl.scrollHeight;
  }
}

function toggleService(panel, serviceName) {
  if (panel.filter === null) {
    panel.filter = new Set([serviceName]);
  } else {
    if (panel.filter.has(serviceName)) {
      panel.filter.delete(serviceName);
    } else {
      panel.filter.add(serviceName);
    }
    if (panel.filter.size === 0) {
      panel.filter = null;
    }
  }
  updatePanelChips(panel);
  renderPanelLogs(panel);
  scheduleUrlSync();
}

function setAllServices(panel) {
  panel.filter = null;
  updatePanelChips(panel);
  renderPanelLogs(panel);
  scheduleUrlSync();
}

function createPanel() {
  panelCounter += 1;
  const id = `panel-${panelCounter}`;

  const fragment = panelTemplate.content.cloneNode(true);
  const panelEl = fragment.querySelector(".panel");
  const titleEl = panelEl.querySelector(".panel-title");
  const metaEl = panelEl.querySelector(".panel-meta");
  const filtersEl = panelEl.querySelector(".panel-filters");
  const logEl = panelEl.querySelector(".log-view");
  const filterBtn = panelEl.querySelector(".toggle-filter");
  const followBtn = panelEl.querySelector(".toggle-follow");
  const closeBtn = panelEl.querySelector(".remove-panel");

  panelEl.dataset.panelId = id;
  panelEl.style.animationDelay = `${Math.min(panelCounter * 0.05, 0.3)}s`;
  titleEl.textContent = `Panel ${panelCounter}`;

  const panel = {
    id,
    el: panelEl,
    logEl,
    filtersEl,
    titleEl,
    metaEl,
    followBtn,
    autoScroll: true,
    filter: null,
    textFilters: {
      include: [],
      exclude: [],
    },
    chipButtons: new Map(),
    allChip: null,
  };

  panelEl.addEventListener("mousedown", () => setActivePanel(id));

  updateFollowState(panel);

  followBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    panel.autoScroll = !panel.autoScroll;
    updateFollowState(panel);
    scheduleUrlSync();
  });

  filterBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openFilterDrawer(panel);
  });

  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.panels.length <= 1) {
      return;
    }
    panelsEl.removeChild(panel.el);
    state.panels = state.panels.filter((item) => item.id !== panel.id);
    if (state.activePanelId === panel.id) {
      const next = state.panels[0];
      if (next) {
        setActivePanel(next.id);
      }
    }
    scheduleUrlSync();
  });

  const allChip = document.createElement("button");
  allChip.className = "chip is-active";
  allChip.textContent = "All";
  allChip.style.setProperty("--chip-color", "#f2cc8f");
  allChip.addEventListener("click", () => setAllServices(panel));
  panel.allChip = allChip;
  filtersEl.appendChild(allChip);

  state.services.forEach((service) => {
    const endpoints = getEndpoints(service);
    const wrap = document.createElement("div");
    wrap.className = "chip-wrap";
    const button = document.createElement("button");
    button.className = "chip";
    button.textContent = service.name;
    button.style.setProperty("--chip-color", colorFor(service.name));
    button.addEventListener("click", () => toggleService(panel, service.name));
    wrap.appendChild(button);
    endpoints.forEach((endpoint) => {
      const link = document.createElement("a");
      link.className = "chip-link";
      link.href = endpoint;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = endpointLabel(endpoint);
      link.addEventListener("click", (event) => event.stopPropagation());
      wrap.appendChild(link);
    });
    filtersEl.appendChild(wrap);
    panel.chipButtons.set(service.name, button);
  });

  panelsEl.appendChild(fragment);
  state.panels.push(panel);

  updatePanelMeta(panel);
  renderPanelLogs(panel);

  if (!state.activePanelId) {
    setActivePanel(panel.id);
  }

  scheduleUrlSync();
  return panel;
}

function renderServiceList() {
  serviceListEl.innerHTML = "";
  state.services.forEach((service) => {
    const endpoints = getEndpoints(service);
    const row = document.createElement("div");
    row.className = "service-row";

    const button = document.createElement("button");
    button.className = "service-button";
    button.addEventListener("click", () => {
      const panel = getActivePanel() || createPanel();
      panel.filter = new Set([service.name]);
      updatePanelChips(panel);
      renderPanelLogs(panel);
      scheduleUrlSync();
    });

    const dot = document.createElement("span");
    dot.className = "service-dot";
    dot.style.setProperty("--chip-color", colorFor(service.name));
    button.appendChild(dot);
    button.appendChild(document.createTextNode(service.name));
    row.appendChild(button);

    if (endpoints.length) {
      const linkWrap = document.createElement("div");
      linkWrap.className = "service-links";
      endpoints.forEach((endpoint) => {
        const link = document.createElement("a");
        link.className = "service-link";
        link.href = endpoint;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = endpointLabel(endpoint);
        linkWrap.appendChild(link);
      });
      row.appendChild(linkWrap);
    } else {
      const status = document.createElement("span");
      status.className = "service-status";
      status.textContent = "internal";
      row.appendChild(status);
    }

    serviceListEl.appendChild(row);
  });
}

function handleLogEvent(entry) {
  state.history.push(entry);
  if (state.history.length > HISTORY_LIMIT) {
    state.history.shift();
  }
  state.panels.forEach((panel) => {
    if (entryMatchesPanel(panel, entry)) {
      appendLogLine(panel, entry);
    }
  });
}

function startEventStream() {
  const stream = new EventSource("/events");
  stream.addEventListener("history", (event) => {
    try {
      const entries = JSON.parse(event.data);
      if (Array.isArray(entries)) {
        state.history = entries.slice(-HISTORY_LIMIT);
        state.panels.forEach((panel) => renderPanelLogs(panel));
      }
    } catch (error) {
      console.error(error);
    }
  });
  stream.onmessage = (event) => {
    try {
      const entry = JSON.parse(event.data);
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
    state.services = payload.services || [];
    renderServiceList();
    if (!restorePanelsFromUrl()) {
      createPanel();
    }
    startEventStream();
  } catch (error) {
    serviceListEl.textContent = "Failed to load services.";
    console.error(error);
  }
}

filterClearBtn.addEventListener("click", () => {
  renderFilterList("include", []);
  renderFilterList("exclude", []);
  syncPanelFiltersFromDrawer();
  const firstInput = filterIncludeList.querySelector("input");
  if (firstInput) {
    firstInput.focus();
  }
});
filterDoneBtn.addEventListener("click", () => closeFilterDrawer());
filterDrawer.addEventListener("input", (event) => {
  if (event.target.matches(".filter-row input")) {
    syncPanelFiltersFromDrawer();
  }
});
filterDrawer.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches(".filter-row input")) {
    event.preventDefault();
    const row = event.target.closest(".filter-row");
    const type = row?.dataset.filter;
    const listEl = type ? filterLists[type] : null;
    if (listEl) {
      const newRow = createFilterRow(type);
      listEl.appendChild(newRow);
      const input = newRow.querySelector("input");
      if (input) {
        input.focus();
      }
    }
  }
});
filterDrawer.addEventListener("click", (event) => {
  const closeTarget = event.target.closest("[data-drawer-close]");
  if (closeTarget) {
    closeFilterDrawer();
    return;
  }
  const addTarget = event.target.closest(".add-filter");
  if (addTarget) {
    const type = addTarget.dataset.filter;
    const listEl = filterLists[type];
    if (listEl) {
      const row = createFilterRow(type);
      listEl.appendChild(row);
      const input = row.querySelector("input");
      if (input) {
        input.focus();
      }
    }
    return;
  }
  const removeTarget = event.target.closest(".remove-filter");
  if (removeTarget) {
    const row = removeTarget.closest(".filter-row");
    const type = row?.dataset.filter;
    if (row) {
      row.remove();
    }
    if (type && filterLists[type] && !filterLists[type].children.length) {
      filterLists[type].appendChild(createFilterRow(type));
    }
    syncPanelFiltersFromDrawer();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && filterDrawer.classList.contains("is-open")) {
    closeFilterDrawer();
  }
});

addPanelBtn.addEventListener("click", () => createPanel());

init();
