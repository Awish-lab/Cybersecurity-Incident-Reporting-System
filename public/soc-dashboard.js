
/* =========================================================
   QONA SACCO - CYBERSECURITY INCIDENT DASHBOARD
   File: public/soc-dashboard.js

   Starts after sign-in through:
       window.initSocDashboard()

   Stops on sign-out through:
       window.stopSocDashboard()
   ========================================================= */

(() => {
    "use strict";

    const API_URL = "/api/dashboard/summary";
    const REFRESH_INTERVAL = 60_000;

    let refreshTimer = null;
    let isLoading = false;
    let listenersBound = false;
    let themeObserver = null;
    let lastData = null;
    let requestController = null;

    const charts = {
        trend: null,
        severity: null,
        status: null
    };

    const SEVERITY_COLORS = {
        critical: "#dc2626",
        high: "#f97316",
        medium: "#eab308",
        low: "#16a34a",
        unknown: "#64748b"
    };

    const STATUS_COLORS = {
        new: "#269b91",
        "under investigation": "#eab308",
        contained: "#7c3aed",
        resolved: "#16a34a",
        closed: "#64748b",
        unknown: "#94a3b8"
    };

    const $ = (id) => document.getElementById(id);

    // =====================================================
    // HELPERS
    // =====================================================

    function getToken() {
        try {
            const session = JSON.parse(
                sessionStorage.getItem("session") || "null"
            );

            return session?.token || null;
        } catch (error) {
            console.warn("Could not read the saved session.", error);
            return null;
        }
    }
function formatDurationHours(hours) {
  if (hours == null || Number.isNaN(Number(hours))) return "—";
  const h = Number(hours);
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}
    function setText(id, value) {
        const element = $(id);
        if (!element) return;

        element.textContent =
            value === null || value === undefined || value === ""
                ? "0"
                : String(value);
    }

    function setConnection(message, connected = false) {
        const element = $("socConnection");
        if (!element) return;

        element.textContent = message;
        element.classList.toggle("online", connected);
        element.setAttribute("aria-live", "polite");

        const wrapper = element.closest(".soc-live");

        if (wrapper) {
            wrapper.classList.toggle("is-online", connected);
            wrapper.classList.toggle(
                "is-offline",
                !connected &&
                    /error|denied|expired|failed/i.test(message)
            );
        }
    }

    function formatDate(value) {
        if (!value) return "Unknown";

        const date = new Date(value);

        return Number.isNaN(date.getTime())
            ? "Unknown"
            : date.toLocaleString();
    }

    function formatIncidentId(id) {
        return id === null || id === undefined
            ? "INC-UNKNOWN"
            : "INC-" + String(id).padStart(4, "0");
    }

    function normalizeClass(value) {
        return String(value || "unknown")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
    }

    function createCell(value) {
        const cell = document.createElement("td");

        cell.textContent =
            value === null || value === undefined || value === ""
                ? "—"
                : String(value);

        return cell;
    }

    function createBadge(value, type) {
        const badge = document.createElement("span");
        const label = value || "Unknown";

        badge.className = `${type} ${normalizeClass(label)}`;
        badge.textContent = label;

        return badge;
    }

    function getArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function getField(object, ...names) {
        for (const name of names) {
            if (
                object &&
                object[name] !== null &&
                object[name] !== undefined
            ) {
                return object[name];
            }
        }

        return null;
    }

    function themeColors() {
        const styles = getComputedStyle(document.documentElement);

        return {
            text:
                styles.getPropertyValue("--text-muted").trim() ||
                "#6e6577",
            grid:
                styles.getPropertyValue("--border").trim() ||
                "#ece5de",
            surface:
                styles.getPropertyValue("--surface").trim() ||
                "#ffffff"
        };
    }

    // =====================================================
    // CHART MANAGEMENT
    // =====================================================

    function drawChart(id, chartKey, config) {
        const canvas = $(id);

        if (!canvas) {
            console.warn(`Chart canvas not found: ${id}`);
            return;
        }

        if (typeof window.Chart !== "function") {
            console.warn(
                "Chart.js is not loaded. Check the Chart.js script in index.html."
            );
            return;
        }

        if (charts[chartKey]) {
            charts[chartKey].destroy();
            charts[chartKey] = null;
        }

        try {
            charts[chartKey] = new window.Chart(
                canvas.getContext("2d"),
                config
            );
        } catch (error) {
            console.error(`Could not draw ${id}:`, error);
        }
    }

    function destroyCharts() {
        Object.keys(charts).forEach((key) => {
            if (charts[key]) {
                charts[key].destroy();
                charts[key] = null;
            }
        });
    }

    function renderTrendChart(items) {
        const colors = themeColors();

        drawChart("socTrendChart", "trend", {
            type: "line",
            data: {
                labels: items.map((item) =>
                    getField(item, "reportDate", "ReportDate", "date") ||
                    "Unknown"
                ),
                datasets: [{
                    label: "Incidents reported",
                    data: items.map((item) =>
                        Number(
                            getField(item, "total", "Total", "count")
                        ) || 0
                    ),
                    borderColor: "#269b91",
                    backgroundColor: "rgba(38, 155, 145, 0.15)",
                    fill: true,
                    tension: 0.35,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: colors.text }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: colors.text },
                        grid: { color: colors.grid }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0,
                            color: colors.text
                        },
                        grid: { color: colors.grid }
                    }
                }
            }
        });
    }

    function renderSeverityChart(items) {
        const colors = themeColors();

        drawChart("socSeverityChart", "severity", {
            type: "doughnut",
            data: {
                labels: items.map((item) =>
                    getField(item, "severity", "Severity") || "Unknown"
                ),
                datasets: [{
                    data: items.map((item) =>
                        Number(
                            getField(item, "total", "Total", "count")
                        ) || 0
                    ),
                    backgroundColor: items.map((item) => {
                        const severity = String(
                            getField(item, "severity", "Severity") || ""
                        ).toLowerCase();

                        return SEVERITY_COLORS[severity] ||
                            SEVERITY_COLORS.unknown;
                    }),
                    borderColor: colors.surface,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: { color: colors.text }
                    }
                }
            }
        });
    }

    function renderStatusChart(items) {
        const colors = themeColors();

        drawChart("socStatusChart", "status", {
            type: "bar",
            data: {
                labels: items.map((item) =>
                    getField(item, "status", "Status") || "Unknown"
                ),
                datasets: [{
                    label: "Incidents",
                    data: items.map((item) =>
                        Number(
                            getField(item, "total", "Total", "count")
                        ) || 0
                    ),
                    backgroundColor: items.map((item) => {
                        const status = String(
                            getField(item, "status", "Status") || ""
                        ).toLowerCase();

                        return STATUS_COLORS[status] ||
                            STATUS_COLORS.unknown;
                    }),
                    borderRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        ticks: { color: colors.text },
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0,
                            color: colors.text
                        },
                        grid: { color: colors.grid }
                    }
                }
            }
        });
    }

    // =====================================================
    // RECENT INCIDENTS
    // =====================================================

    function renderRecentIncidents(incidents) {
        const tbody = $("socRecentBody");
        if (!tbody) return;

        tbody.replaceChildren();

        incidents = getArray(incidents);

        if (incidents.length === 0) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");

            cell.colSpan = 6;
            cell.textContent = "No incidents have been reported yet.";
            cell.className = "empty-state";

            row.appendChild(cell);
            tbody.appendChild(row);
            return;
        }

        incidents.forEach((incident) => {
            const row = document.createElement("tr");

            // Incident title and ID
            const incidentCell = document.createElement("td");

            const title = document.createElement("span");
            title.className = "soc-alert-title";
            title.textContent =
                getField(
                    incident,
                    "IncidentTitle",
                    "Title",
                    "title",
                    "IncidentName"
                ) || "Untitled";

            const id = document.createElement("span");
            id.className = "soc-alert-id";
            id.textContent = formatIncidentId(
                getField(incident, "IncidentID", "IncidentId", "id", "ID")
            );

            incidentCell.append(title, id);
            row.appendChild(incidentCell);

            // Incident type
            row.appendChild(
                createCell(
                    getField(
                        incident,
                        "IncidentType",
                        "Type",
                        "type"
                    )
                )
            );

            // Severity
            const severityCell = document.createElement("td");
            severityCell.appendChild(
                createBadge(
                    getField(incident, "Severity", "severity"),
                    "severity"
                )
            );
            row.appendChild(severityCell);

            // Affected system
            row.appendChild(
                createCell(
                    getField(
                        incident,
                        "AffectedSystem",
                        "AffectedSystemName",
                        "affectedSystem",
                        "affected_system"
                    )
                )
            );

            // Status
            const statusCell = document.createElement("td");
            statusCell.appendChild(
                createBadge(
                    getField(incident, "Status", "status"),
                    "status"
                )
            );
            row.appendChild(statusCell);

            // Date reported
            row.appendChild(
                createCell(
                    formatDate(
                        getField(
                            incident,
                            "DateReported",
                            "ReportedAt",
                            "CreatedAt",
                            "dateReported",
                            "createdAt"
                        )
                    )
                )
            );

            tbody.appendChild(row);
        });
    }

    // =====================================================
    // DASHBOARD RENDERING
    // =====================================================

    function renderDashboard(data) {
        const kpis = data.kpis || data.KPIs || {};

        setText(
            "socTotal",
            getField(kpis, "totalIncidents", "TotalIncidents") ?? 0
        );

        setText(
            "socOpen",
            getField(kpis, "openIncidents", "OpenIncidents") ?? 0
        );

        setText(
            "socUrgent",
            getField(
                kpis,
                "urgentOpenIncidents",
                "UrgentOpenIncidents"
            ) ?? 0
        );

        setText(
            "socResolved",
            getField(
                kpis,
                "resolvedIncidents",
                "ResolvedIncidents"
            ) ?? 0
        );

        setText(
            "socLast24",
            getField(
                kpis,
                "reportedLast24Hours",
                "ReportedLast24Hours"
            ) ?? 0
        );

        renderTrendChart(
            getArray(data.trend || data.Trend)
        );

        renderSeverityChart(
            getArray(data.severity || data.Severity)
        );

        renderStatusChart(
            getArray(data.statuses || data.Statuses)
        );

        renderRecentIncidents(
            data.recentIncidents || data.RecentIncidents
        );

        setConnection("Database connected", true);

        const generatedAt =
            data.generatedAt ||
            data.GeneratedAt ||
            new Date().toISOString();

        setText(
            "socLastUpdated",
            `Last updated: ${formatDate(generatedAt)}`
        );
    }

    function resetDashboard() {
        [
            "socTotal",
            "socOpen",
            "socUrgent",
            "socResolved",
            "socLast24"
        ].forEach((id) => {
            const element = $(id);
            if (element) element.textContent = "—";
        });

        const tbody = $("socRecentBody");
        if (tbody) tbody.replaceChildren();

        destroyCharts();

        setConnection("Connecting to database...", false);
        setText("socLastUpdated", "Waiting for first update...");
    }

    // =====================================================
    // LOAD DATA FROM SERVER
    // =====================================================

    async function loadSocDashboard() {
        if (isLoading || !$("socTotal") || document.hidden) return;

        isLoading = true;

        const refreshButton = $("socRefreshBtn");
        if (refreshButton) refreshButton.disabled = true;

        setConnection("Connecting to database...", false);

        // Abort an old request if one exists.
        if (requestController) {
            requestController.abort();
        }

        requestController = new AbortController();

        try {
            const headers = {
                Accept: "application/json"
            };

            const token = getToken();

            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            const response = await fetch(API_URL, {
                method: "GET",
                headers,
                cache: "no-store",
                signal: requestController.signal
            });

            if (response.status === 401 || response.status === 403) {
                stopSocDashboard();

                setConnection(
                    response.status === 401
                        ? "Session expired. Please sign in again."
                        : "Access denied",
                    false
                );

                return;
            }

            const contentType =
                response.headers.get("content-type") || "";

            if (!response.ok) {
                throw new Error(
                    `Dashboard API returned HTTP ${response.status}.`
                );
            }

            if (!contentType.includes("application/json")) {
                throw new Error(
                    "Dashboard API did not return JSON. Check server.js."
                );
            }

            const data = await response.json();

            if (!data || data.success !== true) {
                throw new Error(
                    data?.message ||
                    "The dashboard API did not return success: true."
                );
            }

            lastData = data;
            renderDashboard(data);

        } catch (error) {
            if (error.name === "AbortError") return;

            console.error("Unable to load SOC dashboard:", error);

            setConnection(
                `Connection error: ${error.message}`,
                false
            );

            setText("socLastUpdated", error.message);

        } finally {
            isLoading = false;
            requestController = null;

            if (refreshButton) {
                refreshButton.disabled = false;
            }
        }
    }

    // =====================================================
    // EVENT LISTENERS
    // =====================================================

    function bindListenersOnce() {
        if (listenersBound) return;
        listenersBound = true;

        const refreshButton = $("socRefreshBtn");

        if (refreshButton) {
            refreshButton.addEventListener("click", () => {
                loadSocDashboard();
            });
        }

        // Redraw charts when the page theme changes.
        if (typeof MutationObserver !== "undefined") {
            themeObserver = new MutationObserver(() => {
                if (!lastData) return;

                renderTrendChart(
                    getArray(lastData.trend || lastData.Trend)
                );

                renderSeverityChart(
                    getArray(lastData.severity || lastData.Severity)
                );

                renderStatusChart(
                    getArray(lastData.statuses || lastData.Statuses)
                );
            });

            themeObserver.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ["data-theme", "class"]
            });
        }

        // Refresh when the user returns to the browser tab.
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && refreshTimer) {
                loadSocDashboard();
            }
        });
    }

    // =====================================================
    // START / STOP
    // =====================================================

    function initSocDashboard() {
        if (!$("socTotal")) {
            console.warn(
                "SOC dashboard elements were not found. " +
                "Check the IDs in index.html."
            );
            return;
        }

        if (refreshTimer) return;

        bindListenersOnce();
        loadSocDashboard();

        refreshTimer = setInterval(() => {
            if (!document.hidden) {
                loadSocDashboard();
            }
        }, REFRESH_INTERVAL);
    }

    function stopSocDashboard() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }

        if (requestController) {
            requestController.abort();
            requestController = null;
        }

        isLoading = false;
        lastData = null;

        resetDashboard();
    }

    window.initSocDashboard = initSocDashboard;
    window.stopSocDashboard = stopSocDashboard;
})();
