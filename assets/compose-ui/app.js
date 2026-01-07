const state = {
  services: [],
  panels: [],
  activePanelId: null,
  history: [],
};

const HISTORY_LIMIT = 2000;
const MAX_LINES_PER_PANEL = 800;

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

const panelsEl = document.getElementById("panels");
const serviceListEl = document.getElementById("service-list");
const addPanelBtn = document.getElementById("add-panel");
const panelTemplate = document.getElementById("panel-template");
const filterModal = document.getElementById("filter-modal");
const filterModalTitle = document.getElementById("filter-modal-title");
const filterModalSubtitle = document.getElementById("filter-modal-subtitle");
const filterIncludeList = document.querySelector("[data-filter-list='include']");
const filterExcludeList = document.querySelector("[data-filter-list='exclude']");
const filterClearBtn = document.getElementById("filter-clear");
const filterDoneBtn = document.getElementById("filter-done");

const filterLists = {
  include: filterIncludeList,
  exclude: filterExcludeList,
};

let modalPanel = null;

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
  state.activePanelId = panelId;
  state.panels.forEach((panel) => {
    panel.el.classList.toggle("is-active", panel.id === panelId);
  });
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

function createLogLine(entry) {
  const lineEl = document.createElement("div");
  lineEl.className = "log-line";

  const serviceEl = document.createElement("span");
  serviceEl.className = "log-service";
  serviceEl.textContent = entry.service;
  serviceEl.style.setProperty("--chip-color", colorFor(entry.service));

  const textEl = document.createElement("span");
  textEl.className = "log-text";
  textEl.textContent = entry.line;

  lineEl.appendChild(serviceEl);
  lineEl.appendChild(textEl);
  return lineEl;
}

function normalizeFilterToken(value) {
  if (!value) {
    return "";
  }
  return value.trim().toLowerCase();
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

function syncPanelFiltersFromModal() {
  if (!modalPanel) {
    return;
  }
  modalPanel.textFilters.include = readFilterList(filterIncludeList);
  modalPanel.textFilters.exclude = readFilterList(filterExcludeList);
  updatePanelMeta(modalPanel);
  filterModalSubtitle.textContent = modalPanel.metaEl.textContent;
  renderPanelLogs(modalPanel);
}

function openFilterModal(panel) {
  modalPanel = panel;
  renderFilterList("include", panel.textFilters.include);
  renderFilterList("exclude", panel.textFilters.exclude);
  filterModalTitle.textContent = `${panel.titleEl.textContent} filters`;
  filterModalSubtitle.textContent = panel.metaEl.textContent;
  filterModal.classList.add("is-open");
  filterModal.setAttribute("aria-hidden", "false");
  const firstInput = filterIncludeList.querySelector("input");
  if (firstInput) {
    firstInput.focus();
  }
}

function closeFilterModal() {
  filterModal.classList.remove("is-open");
  filterModal.setAttribute("aria-hidden", "true");
  modalPanel = null;
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
}

function setAllServices(panel) {
  panel.filter = null;
  updatePanelChips(panel);
  renderPanelLogs(panel);
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

  followBtn.textContent = "Follow";

  followBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    panel.autoScroll = !panel.autoScroll;
    followBtn.textContent = panel.autoScroll ? "Follow" : "Paused";
    followBtn.classList.toggle("chip-muted", !panel.autoScroll);
    followBtn.classList.toggle("is-active", panel.autoScroll);
  });

  filterBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openFilterModal(panel);
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
    createPanel();
    startEventStream();
  } catch (error) {
    serviceListEl.textContent = "Failed to load services.";
    console.error(error);
  }
}

filterClearBtn.addEventListener("click", () => {
  renderFilterList("include", []);
  renderFilterList("exclude", []);
  syncPanelFiltersFromModal();
  const firstInput = filterIncludeList.querySelector("input");
  if (firstInput) {
    firstInput.focus();
  }
});
filterDoneBtn.addEventListener("click", () => closeFilterModal());
filterModal.addEventListener("input", (event) => {
  if (event.target.matches(".filter-row input")) {
    syncPanelFiltersFromModal();
  }
});
filterModal.addEventListener("keydown", (event) => {
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
filterModal.addEventListener("click", (event) => {
  const closeTarget = event.target.closest("[data-modal-close]");
  if (closeTarget) {
    closeFilterModal();
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
    syncPanelFiltersFromModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && filterModal.classList.contains("is-open")) {
    closeFilterModal();
  }
});

addPanelBtn.addEventListener("click", () => createPanel());

init();
