
/* =========================================================
   QONA SACCO - CYBERSECURITY INCIDENT DASHBOARD
   File: public/soc-dashboard.js
   ========================================================= */

(() => {
    "use strict";

    const API_URL = "/api/dashboard/summary";
    const REFRESH_INTERVAL = 60_000;

    let isLoading = false;
    let refreshTimer = null;

    const charts = {
        trend: null,
        severity: null,
        status: null
    };

    const $ = (id) => document.getElementById(id);

    // Safely display text in an element.
    function setText(id, value) {
        const element = $(id);

        if (element) {
            element.textContent =
                value === null || value === undefined
                    ? "0"
                    : String(value);
        }
    }

    // Display the database connection state.
    function setConnection(message, connected = false) {
        const element = $("socConnection");

        if (!element) return;

        element.textContent = message;
        element.classList.toggle("online", connected);
        element.setAttribute(
            "aria-live",
            "polite"
        );
    }

    // Convert database dates into readable local dates.
    function formatDate(value) {
        if (!value) return "Unknown";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "Unknown";
        }

        return date.toLocaleString();
    }

    // Safely create an HTML table cell.
    function createCell(value) {
        const cell = document.createElement("td");
        cell.textContent =
            value === null || value === undefined
                ? "—"
                : String(value);

        return cell;
    }

    // Format status and severity badge classes.
    function normalizeClass(value) {
        return String(value || "")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
    }

    function createBadge(value, type) {
        const badge = document.createElement("span");

        badge.className =
            `${type} ${normalizeClass(value)}`;

        badge.textContent = value || "Unknown";

        return badge;
    }

    // Draw or update a Chart.js chart.
    function drawChart(id, chartKey, config) {
        const canvas = $(id);

        if (!canvas || typeof window.Chart === "undefined") {
            console.warn(
                `Chart unavailable: ${id}. Check the Chart.js script.`
            );
            return;
        }

        if (charts[chartKey]) {
            charts[chartKey].destroy();
        }

        charts[chartKey] = new window.Chart(
            canvas.getContext("2d"),
            config
        );
    }

    // Create the incidents-over-time line chart.
    function renderTrendChart(data) {
        drawChart("socTrendChart", "trend", {
            type: "line",

            data: {
                labels: data.map(item => item.reportDate),

                datasets: [{
                    label: "Incidents reported",
                    data: data.map(item => Number(item.total) || 0),
                    borderColor: "#2563eb",
                    backgroundColor: "rgba(37, 99, 235, 0.12)",
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
                        display: true
                    }
                },

                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        });
    }

    // Create the severity chart.
    function renderSeverityChart(data) {
        drawChart("socSeverityChart", "severity", {
            type: "doughnut",

            data: {
                labels: data.map(item => item.severity),

                datasets: [{
                    data: data.map(item => Number(item.total) || 0),

                    backgroundColor: [
                        "#dc2626",
                        "#f97316",
                        "#eab308",
                        "#16a34a",
                        "#64748b"
                    ],

                    borderWidth: 2
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                plugins: {
                    legend: {
                        position: "bottom"
                    }
                }
            }
        });
    }

    // Create the incident status chart.
    function renderStatusChart(data) {
        drawChart("socStatusChart", "status", {
            type: "bar",

            data: {
                labels: data.map(item => item.status),

                datasets: [{
                    label: "Incidents",
                    data: data.map(item => Number(item.total) || 0),
                    backgroundColor: "#0f766e",
                    borderRadius: 5
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                plugins: {
                    legend: {
                        display: false
                    }
                },

                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        });
    }

    // Populate the recent incidents table safely.
    function renderRecentIncidents(incidents) {
        const tbody = $("socRecentBody");

        if (!tbody) return;

        tbody.replaceChildren();

        if (!Array.isArray(incidents) || incidents.length === 0) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");

            cell.colSpan = 7;
            cell.textContent = "No incidents have been reported yet.";
            cell.className = "empty-state";

            row.appendChild(cell);
            tbody.appendChild(row);

            return;
        }

        incidents.forEach(incident => {
            const row = document.createElement("tr");

            row.appendChild(
                createCell(incident.IncidentID)
            );

            row.appendChild(
                createCell(incident.IncidentTitle)
            );

            row.appendChild(
                createCell(incident.IncidentType)
            );

            const severityCell = document.createElement("td");
            severityCell.appendChild(
                createBadge(incident.Severity, "severity")
            );
            row.appendChild(severityCell);

            row.appendChild(
                createCell(incident.AffectedSystem)
            );

            const statusCell = document.createElement("td");
            statusCell.appendChild(
                createBadge(incident.Status, "status")
            );
            row.appendChild(statusCell);

            row.appendChild(
                createCell(formatDate(incident.DateReported))
            );

            tbody.appendChild(row);
        });
    }

    // Display the dashboard information returned by the API.
    function renderDashboard(data) {
        const kpis = data.kpis || {};

        setText("socTotal", kpis.totalIncidents);
        setText("socOpen", kpis.openIncidents);
        setText("socUrgent", kpis.urgentOpenIncidents);
        setText("socResolved", kpis.resolvedIncidents);
        setText("socLast24", kpis.reportedLast24Hours);

        renderTrendChart(
            Array.isArray(data.trend) ? data.trend : []
        );

        renderSeverityChart(
            Array.isArray(data.severity) ? data.severity : []
        );

        renderStatusChart(
            Array.isArray(data.statuses) ? data.statuses : []
        );

        renderRecentIncidents(data.recentIncidents);

        setConnection("Database connected", true);

        setText(
            "socLastUpdated",
            `Last updated: ${formatDate(data.generatedAt || new Date())}`
        );
    }

    // Fetch current dashboard information from the server.
    async function loadSocDashboard() {
        if (isLoading || !$("socTotal")) {
            return;
        }

        isLoading = true;

        const refreshButton = $("socRefreshBtn");

        if (refreshButton) {
            refreshButton.disabled = true;
        }

        setConnection("Connecting to database...", false);

        try {
            const response = await fetch(API_URL, {
                method: "GET",
                headers: {
                    "Accept": "application/json"
                },
                cache: "no-store"
            });

            if (!response.ok) {
                throw new Error(
                    `Dashboard API returned HTTP ${response.status}`
                );
            }

            const data = await response.json();

            if (data.success !== true) {
                throw new Error(
                    data.message || "The server did not return success."
                );
            }

            renderDashboard(data);

        } catch (error) {
            console.error(
                "Unable to load SOC dashboard:",
                error
            );

            setConnection("Connection error", false);

            setText("socLastUpdated", error.message);

        } finally {
            isLoading = false;

            if (refreshButton) {
                refreshButton.disabled = false;
            }
        }
    }

    // Start the dashboard and automatic refresh.
    function initSocDashboard() {
        if (!$("socTotal")) {
            console.warn(
                "SOC dashboard elements were not found in index.html."
            );
            return;
        }

        const refreshButton = $("socRefreshBtn");

        if (refreshButton) {
            refreshButton.addEventListener(
                "click",
                loadSocDashboard
            );
        }

        loadSocDashboard();

        if (refreshTimer) {
            clearInterval(refreshTimer);
        }

        refreshTimer = setInterval(
            loadSocDashboard,
            REFRESH_INTERVAL
        );

        // Redraw charts when the page theme changes.
        const observer = new MutationObserver(() => {
            if (charts.trend || charts.severity || charts.status) {
                loadSocDashboard();
            }
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class", "data-theme"]
        });
    }

    // Wait until the HTML has been loaded.
    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initSocDashboard,
            { once: true }
        );
    } else {
        initSocDashboard();
    }
})();