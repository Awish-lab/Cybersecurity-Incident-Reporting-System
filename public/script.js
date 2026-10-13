"use strict";

// ==========================================
// STATE
// ==========================================
let incidents = [];
let selectedIncidentId = null;
let lastFocusedElement = null;
let sortKey = "IncidentID";
let sortDir = "desc";
let currentPage = 1;
let totalPages = 1;
let totalIncidents = 0;
const PAGE_SIZE = 25;
const TABLE_COLUMNS = 7;

let auditPage = 1;
let auditTotalPages = 1;
let auditLogs = [];

// ==========================================
// HELPERS
// ==========================================
const $ = (id) => document.getElementById(id);

function showToast(message, type = "info") {
  const container = $("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("leaving");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }, 4000);
}

function formatIncidentId(id) {
  return "INC-" + String(id).padStart(4, "0");
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function toClassName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

async function apiRequest(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (currentUser?.token) headers.Authorization = `Bearer ${currentUser.token}`;
  const response = await fetch(url, { ...options, headers });
  let data = {};
  try {
    data = await response.json();
  } catch {
    /* no JSON */
  }
  if (response.status === 401) {
    logout();
    throw new Error(data.message || "Session expired. Please sign in again.");
  }
  if (!response.ok) {
    throw new Error(data.message || `Request failed (${response.status}).`);
  }
  return data;
}

// ==========================================
// MODALS
// ==========================================
function openModal(id, focusSelector) {
  const modal = $(id);
  if (!modal) return;
  lastFocusedElement = document.activeElement;
  modal.classList.add("active");
  const target = focusSelector && modal.querySelector(focusSelector);
  if (target) target.focus();
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.remove("active");
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
  }
}

function openIncidentForm() {
  if (currentUser) {
    const reporter = $("reportedBy");
    if (reporter) {
      reporter.value = currentUser.name;
      reporter.readOnly = !isAdmin();
    }
  }
  openModal("incidentModal", "#incidentTitle");
}

function closeIncidentForm() {
  closeModal("incidentModal");
}

function closeIncidentDetails() {
  closeModal("incidentDetailsModal");
  selectedIncidentId = null;
}

function setupModalDismissal() {
  const closers = {
    incidentModal: closeIncidentForm,
    incidentDetailsModal: closeIncidentDetails
  };
  Object.entries(closers).forEach(([id, close]) => {
    const modal = $(id);
    if (!modal) return;
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    Object.entries(closers).forEach(([id, close]) => {
      if ($(id)?.classList.contains("active")) close();
    });
  });
}

// ==========================================
// LOAD INCIDENTS
// ==========================================
async function loadIncidents() {
  if (incidents.length === 0) showLoading();
  try {
    const from = $("dateFrom")?.value || "";
    const to = $("dateTo")?.value || "";
    const params = new URLSearchParams({
      page: String(currentPage),
      limit: String(PAGE_SIZE)
    });
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    const result = await apiRequest(`/api/incidents?${params}`);
    incidents = result.incidents || [];
    totalPages = result.pagination?.totalPages || 1;
    totalIncidents = result.pagination?.total ?? incidents.length;
    currentPage = result.pagination?.page || currentPage;

    renderIncidents();
    updateStatistics();
    renderRecent();
    renderBoard();
    renderReports();
    renderPagination();
  } catch (error) {
    console.error("Error loading incidents:", error);
    showToast("Unable to load incidents from the database.", "error");
    renderIncidents();
  }
}

function renderPagination() {
  const el = $("pagination");
  if (!el) return;
  if (totalPages <= 1) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <button type="button" class="ghost-btn" ${currentPage <= 1 ? "disabled" : ""}
      onclick="goPage(${currentPage - 1})">← Prev</button>
    <span>Page ${currentPage} of ${totalPages}</span>
    <button type="button" class="ghost-btn" ${currentPage >= totalPages ? "disabled" : ""}
      onclick="goPage(${currentPage + 1})">Next →</button>
  `;
}

function goPage(page) {
  currentPage = Math.max(1, Math.min(totalPages, page));
  loadIncidents();
}

// ==========================================
// SUBMIT INCIDENT
// ==========================================
async function submitIncident(event) {
  event.preventDefault();
  const submitButton = event.target.querySelector('[type="submit"]');
  const incidentData = {
    title: $("incidentTitle").value.trim(),
    type: $("incidentType").value,
    severity: $("incidentSeverity").value,
    affectedSystem: $("affectedSystem").value.trim(),
    reportedBy: $("reportedBy").value.trim(),
    description: $("incidentDescription").value.trim()
  };
  if (submitButton) submitButton.disabled = true;
  try {
    const result = await apiRequest("/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(incidentData)
    });
    showToast(
      `Incident ${formatIncidentId(result.incidentId)} reported successfully.`,
      "success"
    );
    $("incidentForm").reset();
    closeIncidentForm();
    await loadIncidents();
    if (isAdmin()) loadNotifications();
  } catch (error) {
    console.error("Error reporting incident:", error);
    showToast("Unable to report the incident. " + error.message, "error");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

// ==========================================
// RENDER INCIDENTS
// ==========================================
const SEVERITY_RANK = { Critical: 4, High: 3, Medium: 2, Low: 1 };

function compareIncidents(a, b) {
  const direction = sortDir === "asc" ? 1 : -1;
  let x = a[sortKey];
  let y = b[sortKey];
  if (sortKey === "Severity") {
    x = SEVERITY_RANK[x] || 0;
    y = SEVERITY_RANK[y] || 0;
  } else if (sortKey === "DateReported") {
    x = new Date(x).getTime();
    y = new Date(y).getTime();
  } else if (sortKey === "IncidentID") {
    x = Number(x);
    y = Number(y);
  } else {
    return String(x ?? "").localeCompare(String(y ?? "")) * direction;
  }
  return (x - y) * direction;
}

function getFilteredIncidents() {
  const searchValue = ($("searchInput")?.value || "").toLowerCase().trim();
  const severityValue = $("severityFilter")?.value || "all";
  const statusValue = $("statusFilter")?.value || "all";
  return incidents
    .filter((incident) => {
      const matchesSearch = [
        incident.IncidentTitle,
        incident.IncidentType,
        incident.AffectedSystem,
        incident.ReportedBy,
        incident.AssignedTo
      ].some((field) => String(field || "").toLowerCase().includes(searchValue));
      const matchesSeverity =
        severityValue === "all" || incident.Severity === severityValue;
      const matchesStatus =
        statusValue === "all" || incident.Status === statusValue;
      return matchesSearch && matchesSeverity && matchesStatus;
    })
    .sort(compareIncidents);
}

function renderIncidentRow(incident) {
  return `
    <tr class="row-${toClassName(incident.Severity)}">
      <td>${formatIncidentId(incident.IncidentID)}</td>
      <td>${escapeHTML(incident.IncidentTitle)}</td>
      <td>${escapeHTML(incident.IncidentType)}</td>
      <td>
        <span class="severity ${toClassName(incident.Severity)}">
          ${escapeHTML(incident.Severity)}
        </span>
      </td>
      <td>
        <span class="status ${toClassName(incident.Status)}">
          ${escapeHTML(incident.Status)}
        </span>
      </td>
      <td>${escapeHTML(formatDate(incident.DateReported))}</td>
      <td>
        <button type="button" class="view-btn" data-incident-id="${incident.IncidentID}">
          View
        </button>
      </td>
    </tr>
  `;
}

function showLoading() {
  const tableBody = $("incidentTable");
  if (!tableBody) return;
  const cells = '<td><span class="skeleton"></span></td>'.repeat(TABLE_COLUMNS);
  tableBody.innerHTML = `<tr class="skeleton-row" aria-hidden="true">${cells}</tr>`.repeat(5);
}

function updateSortIndicators() {
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    const active = th.dataset.sort === sortKey;
    th.setAttribute(
      "aria-sort",
      active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
    );
  });
}

function renderIncidents() {
  const tableBody = $("incidentTable");
  if (!tableBody) return;
  const filtered = getFilteredIncidents();
  updateSortIndicators();
  const footer = $("resultCount");
  if (footer) {
    footer.textContent = totalIncidents
      ? `Showing ${filtered.length} on this page · ${totalIncidents} total`
      : "";
  }
  if (filtered.length === 0) {
    const message =
      totalIncidents === 0
        ? "No incidents reported yet."
        : "No incidents match your filters.";
    tableBody.innerHTML = `
      <tr><td colspan="${TABLE_COLUMNS}" class="empty-state">${message}</td></tr>
    `;
    return;
  }
  tableBody.innerHTML = filtered.map(renderIncidentRow).join("");
}

function filterIncidents() {
  currentPage = 1;
  loadIncidents();
}

// ==========================================
// DASHBOARD STATISTICS
// ==========================================
function updateStatistics() {
  const count = (predicate) => incidents.filter(predicate).length;
  const stats = {
    criticalCount: count((i) => i.Severity === "Critical"),
    highCount: count((i) => i.Severity === "High"),
    mediumCount: count((i) => i.Severity === "Medium"),
    resolvedCount: count((i) => i.Status === "RESOLVED")
  };
  Object.entries(stats).forEach(([id, value]) => {
    const element = $(id);
    if (element) element.textContent = value;
  });
}

// ==========================================
// INCIDENT DETAILS + ASSIGN + COMMENTS
// ==========================================
async function viewIncident(incidentId) {
  const incident = incidents.find(
    (item) => Number(item.IncidentID) === Number(incidentId)
  );
  if (!incident) {
    showToast("Incident not found.", "error");
    return;
  }
  selectedIncidentId = incident.IncidentID;

  const fields = {
    detailIncidentID: formatIncidentId(incident.IncidentID),
    detailIncidentTitle: incident.IncidentTitle,
    detailIncidentType: incident.IncidentType,
    detailIncidentSeverity: incident.Severity,
    detailAffectedSystem: incident.AffectedSystem,
    detailReportedBy: incident.ReportedBy,
    detailDateReported: formatDate(incident.DateReported),
    detailDescription: incident.Description
  };
  Object.entries(fields).forEach(([id, value]) => {
    const el = $(id);
    if (el) el.textContent = value || "-";
  });

  if ($("detailStatus")) {
    $("detailStatus").value = incident.Status || "NEW";
    $("detailStatus").disabled = !isAdmin();
  }
  if ($("saveStatusBtn")) $("saveStatusBtn").hidden = !isAdmin();

  const assignee = $("detailAssignee");
  if (assignee) {
    assignee.value = incident.AssignedTo || "";
    assignee.disabled = !isAdmin();
  }

  openModal("incidentDetailsModal", isAdmin() ? "#detailStatus" : undefined);
  await loadComments(selectedIncidentId);
}

async function loadComments(incidentId) {
  const list = $("commentsList");
  if (!list) return;
  list.innerHTML = `<p class="empty-state">Loading…</p>`;
  try {
    const data = await apiRequest(`/api/incidents/${incidentId}/comments`);
    const comments = data.comments || [];
    if (!comments.length) {
      list.innerHTML = `<p class="empty-state">No activity yet.</p>`;
      return;
    }
    list.innerHTML = comments
      .map(
        (c) => `
      <article class="comment">
        <header>
          <strong>${escapeHTML(c.Author)}</strong>
          <time>${escapeHTML(formatDate(c.CreatedAt))}</time>
        </header>
        <p>${escapeHTML(c.CommentText)}</p>
      </article>`
      )
      .join("");
  } catch {
    list.innerHTML = `<p class="empty-state">Could not load comments.</p>`;
  }
}

async function addComment() {
  if (!selectedIncidentId) return;
  const text = ($("newComment")?.value || "").trim();
  if (!text) {
    showToast("Write a comment first.", "info");
    return;
  }
  try {
    await apiRequest(`/api/incidents/${selectedIncidentId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: text })
    });
    if ($("newComment")) $("newComment").value = "";
    await loadComments(selectedIncidentId);
    showToast("Comment added.", "success");
  } catch (error) {
    showToast(error.message || "Failed to add comment.", "error");
  }
}

async function saveAssignee() {
  if (!isAdmin() || !selectedIncidentId) return;
  const assignedTo = $("detailAssignee")?.value || "";
  try {
    await apiRequest(`/api/incidents/${selectedIncidentId}/assign`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedTo })
    });
    showToast("Assignee updated.", "success");
    await loadIncidents();
    await loadComments(selectedIncidentId);
  } catch (error) {
    showToast(error.message || "Failed to assign.", "error");
  }
}

async function saveIncidentStatus() {
  if (!isAdmin()) {
    showToast("Only administrators can change an incident's status.", "error");
    return;
  }
  if (!selectedIncidentId) {
    showToast("No incident selected.", "error");
    return;
  }
  const status = $("detailStatus").value;
  if (!status) {
    showToast("Please select a status.", "error");
    return;
  }
  try {
    await apiRequest(`/api/incidents/${selectedIncidentId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    showToast("Incident status updated.", "success");
    await loadIncidents();
    await loadComments(selectedIncidentId);
  } catch (error) {
    console.error("Error updating incident status:", error);
    showToast("Failed to update status. " + error.message, "error");
  }
}

// ==========================================
// NOTIFICATIONS
// ==========================================
async function loadNotifications() {
  if (!isAdmin()) return;
  try {
    const data = await apiRequest("/api/notifications");
    const items = data.notifications || [];
    const unread = items.filter((n) => !n.IsRead).length;
    const badge = $("notifBadge");
    if (badge) {
      badge.textContent = String(unread);
      badge.hidden = unread === 0;
    }
    const panel = $("notifPanel");
    if (panel && !panel.hidden) {
      panel.innerHTML = items.length
        ? items
            .map(
              (n) => `
          <button type="button" class="notif-item ${n.IsRead ? "" : "unread"}"
            onclick="openNotification(${n.NotificationID}, ${n.IncidentID ?? "null"})">
            <strong>${escapeHTML(n.Title)}</strong>
            <span>${escapeHTML(n.Body)}</span>
            <time>${escapeHTML(formatDate(n.CreatedAt))}</time>
          </button>`
            )
            .join("")
        : `<p class="empty-state">No notifications</p>`;
    }
  } catch (e) {
    console.warn(e);
  }
}

function toggleNotifications() {
  const panel = $("notifPanel");
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden) loadNotifications();
}

async function openNotification(id, incidentId) {
  try {
    await apiRequest(`/api/notifications/${id}/read`, { method: "POST" });
  } catch {
    /* ignore */
  }
  if (incidentId) viewIncident(incidentId);
  loadNotifications();
}

// ==========================================
// AUDIT LOG
// ==========================================
async function loadAuditLogs() {
  if (!isAdmin()) return;
  const tbody = $("auditTable");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Loading…</td></tr>`;

  try {
    const action = $("auditActionFilter")?.value || "";
    const q = $("auditSearch")?.value?.trim() || "";
    const params = new URLSearchParams({
      page: String(auditPage),
      limit: "50"
    });
    if (action) params.set("action", action);
    if (q) params.set("q", q);

    const data = await apiRequest(`/api/audit-logs?${params}`);
    auditLogs = data.logs || [];
    auditTotalPages = data.pagination?.totalPages || 1;
    const total = data.pagination?.total || 0;

    const countEl = $("auditResultCount");
    if (countEl) {
      countEl.textContent = total
        ? `Showing ${auditLogs.length} of ${total} entries`
        : "";
    }

    renderAuditTable();
    renderAuditPagination();
  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Unable to load audit logs.</td></tr>`;
    showToast(error.message || "Failed to load audit logs.", "error");
  }
}

function renderAuditTable() {
  const tbody = $("auditTable");
  if (!tbody) return;

  if (!auditLogs.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No audit entries match.</td></tr>`;
    return;
  }

  tbody.innerHTML = auditLogs
    .map((row) => {
      const entity =
        row.EntityType && row.EntityID
          ? `${escapeHTML(row.EntityType)} #${row.EntityID}`
          : row.EntityType
            ? escapeHTML(row.EntityType)
            : "—";
      return `
        <tr>
          <td>${escapeHTML(formatDate(row.CreatedAt))}</td>
          <td>${escapeHTML(row.ActorName)} <span class="text-muted">(${escapeHTML(row.ActorUsername)})</span></td>
          <td>${escapeHTML(row.ActorRole)}</td>
          <td><span class="status new">${escapeHTML(row.Action)}</span></td>
          <td>${entity}</td>
          <td>${escapeHTML(row.Details || "—")}</td>
          <td>${escapeHTML(row.IPAddress || "—")}</td>
        </tr>`;
    })
    .join("");
}

function renderAuditPagination() {
  const el = $("auditPagination");
  if (!el) return;
  if (auditTotalPages <= 1) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <button type="button" class="ghost-btn" ${auditPage <= 1 ? "disabled" : ""}
      onclick="goAuditPage(${auditPage - 1})">← Prev</button>
    <span>Page ${auditPage} of ${auditTotalPages}</span>
    <button type="button" class="ghost-btn" ${auditPage >= auditTotalPages ? "disabled" : ""}
      onclick="goAuditPage(${auditPage + 1})">Next →</button>
  `;
}

function goAuditPage(page) {
  auditPage = Math.max(1, Math.min(auditTotalPages, page));
  loadAuditLogs();
}

function filterAuditLogs() {
  auditPage = 1;
  loadAuditLogs();
}

function exportAuditCSV() {
  if (!auditLogs.length) {
    showToast("No audit entries to export.", "info");
    return;
  }
  const columns = [
    ["When", "CreatedAt"],
    ["Username", "ActorUsername"],
    ["Name", "ActorName"],
    ["Role", "ActorRole"],
    ["Action", "Action"],
    ["Entity Type", "EntityType"],
    ["Entity ID", "EntityID"],
    ["Details", "Details"],
    ["IP", "IPAddress"]
  ];
  const lines = [columns.map(([label]) => csvCell(label)).join(",")];
  auditLogs.forEach((row) => {
    lines.push(
      columns
        .map(([, key]) =>
          csvCell(key === "CreatedAt" ? formatDate(row[key]) : row[key])
        )
        .join(",")
    );
  });
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast(`Exported ${auditLogs.length} audit entries.`, "success");
}

// ==========================================
// SORTING
// ==========================================
function setSort(key) {
  if (sortKey === key) {
    sortDir = sortDir === "asc" ? "desc" : "asc";
  } else {
    sortKey = key;
    sortDir = ["IncidentID", "Severity", "DateReported"].includes(key)
      ? "desc"
      : "asc";
  }
  renderIncidents();
}

// ==========================================
// EXPORT TO CSV
// ==========================================
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportIncidentsCSV() {
  const rows = incidents;
  if (rows.length === 0) {
    showToast("There are no incidents to export.", "info");
    return;
  }
  const columns = [
    ["ID", "IncidentID"],
    ["Title", "IncidentTitle"],
    ["Type", "IncidentType"],
    ["Severity", "Severity"],
    ["Status", "Status"],
    ["Assigned To", "AssignedTo"],
    ["Affected System", "AffectedSystem"],
    ["Reported By", "ReportedBy"],
    ["Date Reported", "DateReported"],
    ["Description", "Description"]
  ];
  const format = (key, incident) =>
    key === "IncidentID"
      ? formatIncidentId(incident[key])
      : key === "DateReported"
        ? formatDate(incident[key])
        : incident[key];
  const lines = [columns.map(([label]) => csvCell(label)).join(",")];
  rows.forEach((incident) => {
    lines.push(columns.map(([, key]) => csvCell(format(key, incident))).join(","));
  });
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `incidents-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast(
    `Exported ${rows.length} incident${rows.length === 1 ? "" : "s"}.`,
    "success"
  );
}

// ==========================================
// THEME
// ==========================================
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const button = $("themeToggle");
  if (button) {
    button.setAttribute("aria-pressed", String(theme === "dark"));
    button.textContent = theme === "dark" ? "☀️ Light" : "🌙 Dark";
  }
}

function toggleTheme() {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  if ($("themeSelect")) $("themeSelect").value = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    /* ignore */
  }
}

// ==========================================
// AUTH
// ==========================================
const DEMO_MODE = false;
const DEMO_USERS = {
  admin: { password: "Admin@2026", name: "Administrator", role: "admin" },
  user: { password: "User@2026", name: "Staff User", role: "user" }
};
const ADMIN_VIEWS = ["investigations", "reports", "settings", "audit"];
let currentUser = null;
const isAdmin = () => currentUser?.role === "admin";

function togglePassword(inputId, button) {
  const input = $(inputId);
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  button.setAttribute("aria-pressed", String(show));
  button.setAttribute("aria-label", show ? "Hide password" : "Show password");
}

async function login(event) {
  event.preventDefault();
  const username = $("loginUser").value.trim().toLowerCase();
  const password = $("loginPass").value;
  const errorBox = $("loginError");
  if (errorBox) {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }
  try {
    let session;
    if (DEMO_MODE) {
      const account = DEMO_USERS[username];
      if (!account || account.password !== password) {
        throw new Error("Incorrect username or password.");
      }
      session = { username, name: account.name, role: account.role };
    } else {
      const result = await apiRequest("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      session = {
        username,
        name: result.user.name,
        role: result.user.role,
        token: result.token
      };
    }
    sessionStorage.setItem("session", JSON.stringify(session));
    currentUser = session;
    $("loginForm").reset();
    applySession();
  } catch (error) {
    if (errorBox) {
      errorBox.textContent = error.message || "Unable to sign in.";
      errorBox.hidden = false;
    }
  }
}

function applySession() {
  document.body.classList.add("authed");
  if ($("userBadge")) {
    $("userBadge").textContent = `${currentUser.name} · ${
      isAdmin() ? "Admin" : "User"
    }`;
  }
  if ($("welcomeName")) $("welcomeName").textContent = currentUser.name;

  document.querySelectorAll("[data-admin-only]").forEach((el) => {
    el.hidden = !isAdmin();
  });
  document.querySelectorAll(".nav-label").forEach((el) => {
    el.hidden = !isAdmin() && el.textContent.trim() === "Admin";
  });

  if ($("saveStatusBtn")) $("saveStatusBtn").hidden = !isAdmin();
  if ($("detailStatus")) $("detailStatus").disabled = !isAdmin();
  if ($("detailAssignee")) $("detailAssignee").disabled = !isAdmin();

  route();
  loadIncidents();

  if (isAdmin()) {
    if (typeof window.initSocDashboard === "function") {
      window.initSocDashboard();
    }
    loadNotifications();
  }
}

function logout() {
  if (currentUser?.token) {
    fetch("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${currentUser.token}` }
    }).catch(() => {});
  }
  if (typeof window.stopSocDashboard === "function") {
    window.stopSocDashboard();
  }
  sessionStorage.removeItem("session");
  currentUser = null;
  incidents = [];
  auditLogs = [];
  document.querySelectorAll(".modal").forEach((m) => m.classList.remove("active"));
  const panel = $("notifPanel");
  if (panel) panel.hidden = true;
  document.body.classList.remove("authed");
  history.replaceState(null, "", location.pathname);
  $("loginUser")?.focus();
}

// ==========================================
// PASSWORD CHECKER
// ==========================================
const COMMON_WORDS = [
  "password", "passw0rd", "123456", "12345678", "qwerty", "abc123", "letmein",
  "welcome", "admin", "iloveyou", "monkey", "dragon", "football", "sunshine",
  "master", "login", "111111", "123123", "qona", "sacco", "nairobi", "kenya",
  "mombasa"
];

function analysePassword(pw) {
  const lower = pw.toLowerCase();
  const hasCommon = COMMON_WORDS.some((w) => lower.includes(w));
  const hasRepeat = /(.)\1{2,}/.test(pw);
  const hasSequence =
    /(abc|bcd|cde|def|qwe|wer|ert|asd|sdf|012|123|234|345|456|567|678|789)/i.test(pw);
  const checks = [
    { ok: pw.length >= 12, text: "At least 12 characters" },
    { ok: /[a-z]/.test(pw), text: "A lowercase letter" },
    { ok: /[A-Z]/.test(pw), text: "An uppercase letter" },
    { ok: /\d/.test(pw), text: "A number" },
    { ok: /[^A-Za-z0-9]/.test(pw), text: "A symbol such as ! ? # %" },
    { ok: !hasCommon, text: "No common word like “password” or “qona”" },
    { ok: !hasRepeat && !hasSequence, text: "No repeats or sequences (aaa, 123, qwe)" }
  ];
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 32;
  let bits = pw.length && pool ? pw.length * Math.log2(pool) : 0;
  if (hasCommon) bits = Math.min(bits, 20);
  if (hasRepeat || hasSequence) bits *= 0.75;
  let level = 1;
  if (bits >= 80) level = 5;
  else if (bits >= 60) level = 4;
  else if (bits >= 40) level = 3;
  else if (bits >= 28) level = 2;
  return { checks, bits, level: pw ? level : 0 };
}

function formatCrackTime(bits) {
  const seconds = Math.pow(2, bits) / 2 / 1e10;
  if (seconds < 1) return "instantly";
  if (seconds < 60) return `about ${Math.round(seconds)} seconds`;
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} minutes`;
  if (seconds < 86400) return `about ${Math.round(seconds / 3600)} hours`;
  if (seconds < 86400 * 365) return `about ${Math.round(seconds / 86400)} days`;
  const years = seconds / (86400 * 365);
  return years > 1e9
    ? "billions of years"
    : `about ${Math.round(years).toLocaleString()} years`;
}

function checkPassword() {
  const pw = $("pwInput")?.value || "";
  const { checks, bits, level } = analysePassword(pw);
  const labels = ["", "Very weak", "Weak", "Fair", "Strong", "Very strong"];
  if ($("pwMeter")) $("pwMeter").dataset.level = level;
  if ($("pwSummary")) {
    $("pwSummary").textContent = pw
      ? `${labels[level]}. A fast attacker could crack this ${formatCrackTime(bits)} (rough estimate).`
      : "Start typing to see how strong it is.";
  }
  if ($("pwChecks")) {
    $("pwChecks").innerHTML = checks
      .map(
        (c) => `
      <li class="${pw ? (c.ok ? "pass" : "fail") : ""}">
        <span aria-hidden="true">${pw ? (c.ok ? "✓" : "✗") : "○"}</span> ${c.text}
      </li>`
      )
      .join("");
  }
}

function generatePassword() {
  const sets = [
    "abcdefghijkmnpqrstuvwxyz",
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "23456789",
    "!@#$%^&*?-_="
  ];
  const all = sets.join("");
  const random = (max) => {
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do {
      crypto.getRandomValues(buf);
    } while (buf[0] >= limit);
    return buf[0] % max;
  };
  const chars = sets.map((s) => s[random(s.length)]);
  while (chars.length < 16) chars.push(all[random(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const k = random(i + 1);
    [chars[i], chars[k]] = [chars[k], chars[i]];
  }
  const input = $("pwInput");
  if (!input) return;
  input.value = chars.join("");
  input.type = "text";
  checkPassword();
}

async function copyPassword() {
  const value = $("pwInput")?.value || "";
  if (!value) {
    showToast("Type or generate a password first.", "info");
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    showToast("Password copied. Store it in a password manager.", "success");
  } catch {
    showToast("Couldn't copy automatically. Select it and copy manually.", "error");
  }
}

// ==========================================
// PHISHING QUIZ
// ==========================================
const QUIZ_EMAILS = [
  {
    from: "Account Security <support@qona-sacco-verify.com>",
    subject: "URGENT: Your account will be suspended in 24 hours",
    body: "Dear Customer,\n\nWe noticed unusual activity on your account. To avoid suspension you must confirm your password within 24 hours.\n\n[Verify now] → http://qona-sacco-verify.com/login\n\nAccount Security Team",
    phishing: true,
    flags: [
      "Lookalike domain",
      "Threat and deadline create panic",
      "Generic greeting",
      "Asks you to confirm your password via a link"
    ]
  },
  {
    from: "IT Service Desk <servicedesk@yourcompany.example>",
    subject: "Scheduled maintenance on Saturday, 10pm to 12am",
    body: "Hello team,\n\nThe email server will be briefly unavailable on Saturday night during planned maintenance. No action is needed from you.\n\nThanks,\nIT Service Desk",
    phishing: false,
    flags: [
      "Comes from your organisation's real domain",
      "Asks you to do nothing",
      "Calm tone with no pressure"
    ]
  },
  {
    from: "James Mwangi (CEO) <ceo.office.mwangi@gmail.com>",
    subject: "Quick favour, are you at your desk?",
    body: "I'm in a meeting and can't talk. I need you to buy 5 gift cards for a client today and send me the codes. Keep this between us.\n\nSent from my phone",
    phishing: true,
    flags: [
      "Executive using a free Gmail address",
      "Secrecy request",
      "Gift cards and urgency",
      "Avoids phone calls"
    ]
  },
  {
    from: "Parcel Service <delivery-alert@track-parcel-now.net>",
    subject: "Delivery failed: action required",
    body: "We couldn't deliver your parcel. Open the attached form and pay a small redelivery fee.\n\nAttachment: delivery_form.pdf.exe",
    phishing: true,
    flags: [
      "Unexpected parcel",
      "Double extension .pdf.exe",
      "Asks for a payment"
    ]
  },
  {
    from: "Finance <finance@yourcompany.example>",
    subject: "Your expense claim #4821 was approved",
    body: "Hi Amina,\n\nYour expense claim #4821 for transport (KES 3,200) has been approved.\n\nRegards,\nFinance Team",
    phishing: false,
    flags: [
      "Real internal address",
      "Refers to something you submitted",
      "No links or requests"
    ]
  }
];
let quizIndex = 0;
let quizScore = 0;

function renderQuiz() {
  const box = $("quizBox");
  if (!box) return;
  if (quizIndex >= QUIZ_EMAILS.length) {
    const message =
      quizScore >= 4
        ? "Excellent. You have a sharp eye for phishing."
        : quizScore >= 3
          ? "Good effort. Review the warning signs and try again."
          : "Keep practising.";
    box.innerHTML = `
      <div class="quiz-result">
        <h3>You scored ${quizScore} out of ${QUIZ_EMAILS.length}</h3>
        <p>${message}</p>
        <button type="button" class="submit-btn" onclick="restartQuiz()">Try again</button>
      </div>`;
    return;
  }
  const e = QUIZ_EMAILS[quizIndex];
  box.innerHTML = `
    <p class="quiz-progress">Email ${quizIndex + 1} of ${QUIZ_EMAILS.length}</p>
    <div class="mail">
      <div class="mail-head">
        <div><span>From</span> ${escapeHTML(e.from)}</div>
        <div><span>Subject</span> <strong>${escapeHTML(e.subject)}</strong></div>
      </div>
      <div class="mail-body">${escapeHTML(e.body)}</div>
    </div>
    <div class="quiz-actions" id="quizActions">
      <button type="button" class="submit-btn" onclick="answerQuiz(true)">🎣 It's phishing</button>
      <button type="button" class="cancel-btn" onclick="answerQuiz(false)">✅ It's legitimate</button>
    </div>
    <div id="quizFeedback" aria-live="polite"></div>`;
}

function answerQuiz(saidPhishing) {
  const e = QUIZ_EMAILS[quizIndex];
  const correct = saidPhishing === e.phishing;
  if (correct) quizScore++;
  const last = quizIndex === QUIZ_EMAILS.length - 1;
  if ($("quizActions")) $("quizActions").hidden = true;
  if ($("quizFeedback")) {
    $("quizFeedback").innerHTML = `
      <div class="feedback ${correct ? "right" : "wrong"}">
        <strong>${correct ? "Correct!" : "Not quite."} This email is ${
          e.phishing ? "phishing" : "legitimate"
        }.</strong>
        <ul>${e.flags.map((f) => `<li>${escapeHTML(f)}</li>`).join("")}</ul>
        <button type="button" class="submit-btn" onclick="nextQuiz()">${
          last ? "See my score" : "Next email"
        }</button>
      </div>`;
  }
}

function nextQuiz() {
  quizIndex++;
  renderQuiz();
}

function restartQuiz() {
  quizIndex = 0;
  quizScore = 0;
  renderQuiz();
}

function reportPhishing() {
  openIncidentForm();
  if ($("incidentType")) $("incidentType").value = "Phishing";
}

// ==========================================
// ROUTER
// ==========================================
const VIEWS = {
  password: {
    title: "Password Check",
    subtitle: "Test how strong a password is before you use it"
  },
  phishing: {
    title: "Spot Fake Emails",
    subtitle: "Learn the warning signs of phishing and test yourself"
  },
  dashboard: {
    title: "Security Dashboard",
    subtitle: "Monitor and manage cybersecurity incidents"
  },
  incidents: {
    title: "Incidents",
    subtitle: "Search, filter and manage every reported incident"
  },
  investigations: {
    title: "Investigations",
    subtitle: "Follow each case from report to resolution"
  },
  reports: {
    title: "Reports",
    subtitle: "Trends and summaries across all incidents"
  },
  audit: {
    title: "Audit Log",
    subtitle: "Review who did what and when"
  },
  settings: {
    title: "Settings",
    subtitle: "Customise how the dashboard looks and works"
  }
};
let firstRoute = true;

function route() {
  if (!currentUser) return;
  const name = location.hash.replace(/^#\/?/, "");
  let view = VIEWS[name] ? name : "dashboard";
  if (!isAdmin() && ADMIN_VIEWS.includes(view)) view = "dashboard";

  document.querySelectorAll(".view").forEach((section) => {
    section.hidden = section.dataset.view !== view;
  });
  document.querySelectorAll(".nav-link[data-view]").forEach((link) => {
    const active = link.dataset.view === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if ($("pageTitle")) $("pageTitle").textContent = VIEWS[view].title;
  if ($("pageSubtitle")) $("pageSubtitle").textContent = VIEWS[view].subtitle;
  document.title = `${VIEWS[view].title} · Cyber Incident Management System`;
  if (!firstRoute) $("pageTitle")?.focus();
  firstRoute = false;
  window.scrollTo(0, 0);

  if (view === "audit" && isAdmin()) {
    loadAuditLogs();
  }
}

// ==========================================
// RECENT / BOARD / REPORTS
// ==========================================
function renderRecent() {
  const body = $("recentTable");
  if (!body) return;
  const latest = [...incidents]
    .sort((a, b) => new Date(b.DateReported) - new Date(a.DateReported))
    .slice(0, 5);
  body.innerHTML = latest.length
    ? latest.map(renderIncidentRow).join("")
    : `<tr><td colspan="${TABLE_COLUMNS}" class="empty-state">No incidents reported yet.</td></tr>`;
}

const STATUSES = ["NEW", "UNDER INVESTIGATION", "CONTAINED", "RESOLVED"];

function renderBoard() {
  const board = $("investigationBoard");
  if (!board) return;
  board.innerHTML = STATUSES.map((status) => {
    const cases = incidents
      .filter((i) => i.Status === status)
      .sort(
        (a, b) =>
          (SEVERITY_RANK[b.Severity] || 0) - (SEVERITY_RANK[a.Severity] || 0)
      );
    const cards = cases
      .map(
        (i) => `
      <button type="button" class="case-card row-${toClassName(i.Severity)}" data-incident-id="${i.IncidentID}">
        <span class="case-top">
          <strong>${formatIncidentId(i.IncidentID)}</strong>
          <span class="severity ${toClassName(i.Severity)}">${escapeHTML(i.Severity)}</span>
        </span>
        <span class="case-title">${escapeHTML(i.IncidentTitle)}</span>
        <span class="case-meta">${escapeHTML(i.AffectedSystem)} · ${escapeHTML(formatDate(i.DateReported))}${
          i.AssignedTo ? ` · ${escapeHTML(i.AssignedTo)}` : ""
        }</span>
      </button>`
      )
      .join("");
    return `
      <div class="board-column">
        <h3>${escapeHTML(status)} <span class="board-count">${cases.length}</span></h3>
        <div class="board-cards">${cards || '<p class="board-empty">No incidents</p>'}</div>
      </div>`;
  }).join("");
}

function tally(key) {
  return incidents.reduce((acc, incident) => {
    const label = incident[key] || "Unknown";
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
}

function barList(title, counts) {
  const total = incidents.length;
  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([label, count]) => `
      <li>
        <span class="bar-label">${escapeHTML(label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${
          total ? Math.round((count / total) * 100) : 0
        }%"></span></span>
        <span class="bar-count">${count}</span>
      </li>`
    )
    .join("");
  return `
    <div class="report-block">
      <h3>${title}</h3>
      <ul class="bar-list">${rows || '<li class="board-empty">No data yet</li>'}</ul>
    </div>`;
}

function renderReports() {
  const total = incidents.length;
  const resolved = incidents.filter((i) => i.Status === "RESOLVED").length;
  const criticalOpen = incidents.filter(
    (i) => i.Severity === "Critical" && i.Status !== "RESOLVED"
  ).length;
  const rate = total ? Math.round((resolved / total) * 100) : 0;
  const kpi = (cls, icon, label, value) => `
    <div class="stat-card ${cls}">
      <div class="stat-icon" aria-hidden="true">${icon}</div>
      <div><span>${label}</span><h2>${value}</h2></div>
    </div>`;
  const kpis = $("reportKpis");
  if (kpis) {
    kpis.innerHTML =
      kpi("resolved", "📋", "Total Incidents", total) +
      kpi("high", "🔓", "Still Open", total - resolved) +
      kpi("critical", "🚨", "Critical &amp; Open", criticalOpen) +
      kpi("medium", "✅", "Resolution Rate", rate + "%");
  }
  const charts = $("reportCharts");
  if (charts) {
    charts.innerHTML =
      barList("By severity", tally("Severity")) +
      barList("By type", tally("IncidentType")) +
      barList("By status", tally("Status"));
  }
  const about = $("aboutCount");
  if (about) about.textContent = total;
}

// ==========================================
// SETTINGS
// ==========================================
function setThemePreference(pref) {
  try {
    if (pref === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", pref);
  } catch {
    /* ignore */
  }
  const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(pref === "system" ? (systemDark ? "dark" : "light") : pref);
}

async function refreshData() {
  await loadIncidents();
  if (isAdmin()) {
    loadNotifications();
    if (location.hash.replace(/^#\/?/, "") === "audit") loadAuditLogs();
  }
  showToast("Data refreshed.", "success");
}

// ==========================================
// INIT
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  setupModalDismissal();
  applyTheme(document.documentElement.dataset.theme || "light");
  let savedTheme = "system";
  try {
    savedTheme = localStorage.getItem("theme") || "system";
  } catch {
    /* ignore */
  }
  if ($("themeSelect")) $("themeSelect").value = savedTheme;

  window.addEventListener("hashchange", route);
  checkPassword();
  renderQuiz();
  if (!DEMO_MODE && $("demoBox")) $("demoBox").hidden = true;

  $("detailAssignee")?.addEventListener("change", saveAssignee);

  try {
    const saved = JSON.parse(sessionStorage.getItem("session") || "null");
    if (saved?.role) {
      currentUser = saved;
      applySession();
    }
  } catch {
    sessionStorage.removeItem("session");
  }

  document.querySelector("thead")?.addEventListener("click", (event) => {
    const th = event.target.closest("th[data-sort]");
    if (th) setSort(th.dataset.sort);
  });

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-incident-id]");
    if (trigger) viewIncident(trigger.dataset.incidentId);

    const panel = $("notifPanel");
    const btn = $("notifBtn");
    if (
      panel &&
      !panel.hidden &&
      !panel.contains(event.target) &&
      btn &&
      !btn.contains(event.target)
    ) {
      panel.hidden = true;
    }
  });

  setInterval(() => {
    if (currentUser && isAdmin()) loadNotifications();
  }, 60_000);
});