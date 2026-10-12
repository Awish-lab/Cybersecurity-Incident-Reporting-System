"use strict";

// ==========================================
// STATE
// ==========================================

let incidents = [];
let selectedIncidentId = null;
let lastFocusedElement = null;
let sortKey = "IncidentID";
let sortDir = "desc";

const TABLE_COLUMNS = 7;


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

/** "UNDER INVESTIGATION" -> "under-investigation" (matches the CSS badge classes) */
function toClassName(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function escapeHTML(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
}

/** fetch + JSON parsing + error handling in one place */
async function apiRequest(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (currentUser?.token) headers.Authorization = `Bearer ${currentUser.token}`;

    const response = await fetch(url, { ...options, headers });

    let data = {};
    try {
        data = await response.json();
    } catch {
        // Response had no JSON body; fall through to the status check
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
        reporter.value = currentUser.name;
        reporter.readOnly = !isAdmin();
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

        // Click on the dark backdrop closes the modal
        modal.addEventListener("click", (event) => {
            if (event.target === modal) close();
        });
    });

    // Escape closes whichever modal is open
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
        const result = await apiRequest("/api/incidents");

        incidents = result.incidents || [];

        // Regular users only see incidents they reported (the server must enforce this too)
        if (currentUser && !isAdmin()) {
            incidents = incidents.filter(
                (i) => String(i.ReportedBy || "").toLowerCase() === currentUser.name.toLowerCase()
            );
        }

        renderIncidents();
        updateStatistics();
        renderRecent();
        renderBoard();
        renderReports();
    } catch (error) {
        console.error("Error loading incidents:", error);
        showToast("Unable to load incidents from the database.", "error");
        renderIncidents();
    }
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

    // Prevent double submissions while the request is in flight
    if (submitButton) submitButton.disabled = true;

    try {
        const result = await apiRequest("/api/incidents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(incidentData)
        });

        showToast(`Incident ${formatIncidentId(result.incidentId)} reported successfully.`, "success");

        $("incidentForm").reset();
        closeIncidentForm();

        await loadIncidents();
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
                incident.ReportedBy
            ].some((field) => String(field || "").toLowerCase().includes(searchValue));

            const matchesSeverity = severityValue === "all" || incident.Severity === severityValue;
            const matchesStatus = statusValue === "all" || incident.Status === statusValue;

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
        th.setAttribute("aria-sort", active ? (sortDir === "asc" ? "ascending" : "descending") : "none");
    });
}

function renderIncidents() {
    const tableBody = $("incidentTable");

    if (!tableBody) {
        console.error("Incident table not found.");
        return;
    }

    const filtered = getFilteredIncidents();

    updateSortIndicators();

    const footer = $("resultCount");
    if (footer) {
        footer.textContent = incidents.length
            ? `Showing ${filtered.length} of ${incidents.length} incidents`
            : "";
    }

    if (filtered.length === 0) {
        const message = incidents.length === 0
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
    renderIncidents();
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
// INCIDENT DETAILS
// ==========================================

function viewIncident(incidentId) {
    const incident = incidents.find((item) => Number(item.IncidentID) === Number(incidentId));

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
        $(id).textContent = value || "-";
    });

    // The status is a <select>, so set .value (setting textContent would wipe its options)
    $("detailStatus").value = incident.Status;

    openModal("incidentDetailsModal", "#detailStatus");
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
        closeIncidentDetails();
    } catch (error) {
        console.error("Error updating incident status:", error);
        showToast("Failed to update status. " + error.message, "error");
    }
}


// ==========================================
// SORTING
// ==========================================

function setSort(key) {
    if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
        sortKey = key;
        sortDir = ["IncidentID", "Severity", "DateReported"].includes(key) ? "desc" : "asc";
    }
    renderIncidents();
}


// ==========================================
// EXPORT TO CSV
// ==========================================

/** Quotes a cell and neutralises spreadsheet formulas (=, +, -, @) */
function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
}

function exportIncidentsCSV() {
    const rows = getFilteredIncidents();

    if (rows.length === 0) {
        showToast("There are no incidents to export.", "info");
        return;
    }

    const columns = [
        ["ID", "IncidentID"], ["Title", "IncidentTitle"], ["Type", "IncidentType"],
        ["Severity", "Severity"], ["Status", "Status"], ["Affected System", "AffectedSystem"],
        ["Reported By", "ReportedBy"], ["Date Reported", "DateReported"], ["Description", "Description"]
    ];

    const format = (key, incident) =>
        key === "IncidentID" ? formatIncidentId(incident[key])
        : key === "DateReported" ? formatDate(incident[key])
        : incident[key];

    const lines = [columns.map(([label]) => csvCell(label)).join(",")];
    rows.forEach((incident) => {
        lines.push(columns.map(([, key]) => csvCell(format(key, incident))).join(","));
    });

    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `incidents-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    showToast(`Exported ${rows.length} incident${rows.length === 1 ? "" : "s"}.`, "success");
}


// ==========================================
// THEME (LIGHT / DARK)
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
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    if ($("themeSelect")) $("themeSelect").value = next;

    try {
        localStorage.setItem("theme", next);
    } catch {
        // Storage unavailable (private mode); the theme just won't persist
    }
}


// ==========================================
// AUTHENTICATION
// ==========================================

// DEMO ONLY: these accounts live in the browser, so anyone can read them.
// Set DEMO_MODE to false once your server provides POST /api/auth/login.
const DEMO_MODE = true;
const DEMO_USERS = {
    admin: { password: "Admin@2026", name: "Administrator", role: "admin" },
    user:  { password: "User@2026",  name: "Staff User",    role: "user" }
};
const ADMIN_VIEWS = ["investigations", "reports", "settings"];

let currentUser = null;

const isAdmin = () => currentUser?.role === "admin";

function togglePassword(inputId, button) {
    const input = $(inputId);
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
    errorBox.hidden = true;

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
            session = { username, name: result.user.name, role: result.user.role, token: result.token };
        }

        sessionStorage.setItem("session", JSON.stringify(session));
        currentUser = session;
        $("loginForm").reset();
        applySession();
    } catch (error) {
        errorBox.textContent = error.message || "Unable to sign in.";
        errorBox.hidden = false;
    }
}

function applySession() {
    document.body.classList.add("authed");

    $("userBadge").textContent = `${currentUser.name} · ${isAdmin() ? "Admin" : "User"}`;
    $("welcomeName").textContent = currentUser.name;

    document.querySelectorAll("[data-admin-only]").forEach((el) => { el.hidden = !isAdmin(); });
    document.querySelectorAll(".nav-label").forEach((el) => {
        el.hidden = !isAdmin() && el.textContent.trim() === "Admin";
    });

    $("saveStatusBtn").hidden = !isAdmin();
    $("detailStatus").disabled = !isAdmin();

    route();
    loadIncidents();
}

function logout() {
    sessionStorage.removeItem("session");
    currentUser = null;
    incidents = [];

    document.querySelectorAll(".modal").forEach((m) => m.classList.remove("active"));
    document.body.classList.remove("authed");
    history.replaceState(null, "", location.pathname);
    $("loginUser").focus();
}


// ==========================================
// PASSWORD STRENGTH CHECKER
// ==========================================

const COMMON_WORDS = [
    "password", "passw0rd", "123456", "12345678", "qwerty", "abc123", "letmein", "welcome",
    "admin", "iloveyou", "monkey", "dragon", "football", "sunshine", "master", "login",
    "111111", "123123", "qona", "sacco", "nairobi", "kenya", "mombasa"
];

function analysePassword(pw) {
    const lower = pw.toLowerCase();

    const hasCommon = COMMON_WORDS.some((w) => lower.includes(w));
    const hasRepeat = /(.)\1{2,}/.test(pw);
    const hasSequence = /(abc|bcd|cde|def|qwe|wer|ert|asd|sdf|012|123|234|345|456|567|678|789)/i.test(pw);

    const checks = [
        { ok: pw.length >= 12,           text: "At least 12 characters" },
        { ok: /[a-z]/.test(pw),          text: "A lowercase letter" },
        { ok: /[A-Z]/.test(pw),          text: "An uppercase letter" },
        { ok: /\d/.test(pw),             text: "A number" },
        { ok: /[^A-Za-z0-9]/.test(pw),   text: "A symbol such as ! ? # %" },
        { ok: !hasCommon,                text: "No common word like “password” or “qona”" },
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
    // Rough estimate: an attacker with a fast offline setup trying 10 billion guesses/second
    const seconds = Math.pow(2, bits) / 2 / 1e10;
    if (seconds < 1) return "instantly";
    if (seconds < 60) return `about ${Math.round(seconds)} seconds`;
    if (seconds < 3600) return `about ${Math.round(seconds / 60)} minutes`;
    if (seconds < 86400) return `about ${Math.round(seconds / 3600)} hours`;
    if (seconds < 86400 * 365) return `about ${Math.round(seconds / 86400)} days`;
    const years = seconds / (86400 * 365);
    return years > 1e9 ? "billions of years" : `about ${Math.round(years).toLocaleString()} years`;
}

function checkPassword() {
    const pw = $("pwInput").value;
    const { checks, bits, level } = analysePassword(pw);
    const labels = ["", "Very weak", "Weak", "Fair", "Strong", "Very strong"];

    $("pwMeter").dataset.level = level;
    $("pwSummary").textContent = pw
        ? `${labels[level]}. A fast attacker could crack this ${formatCrackTime(bits)} (rough estimate).`
        : "Start typing to see how strong it is.";

    $("pwChecks").innerHTML = checks.map((c) => `
        <li class="${pw ? (c.ok ? "pass" : "fail") : ""}">
            <span aria-hidden="true">${pw ? (c.ok ? "✓" : "✗") : "○"}</span> ${c.text}
        </li>
    `).join("");
}

function generatePassword() {
    const sets = ["abcdefghijkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*?-_=+"];
    const all = sets.join("");
    const random = (max) => {
        const limit = Math.floor(0x100000000 / max) * max;
        const buf = new Uint32Array(1);
        do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
        return buf[0] % max;
    };

    const chars = sets.map((s) => s[random(s.length)]);
    while (chars.length < 16) chars.push(all[random(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
        const k = random(i + 1);
        [chars[i], chars[k]] = [chars[k], chars[i]];
    }

    const input = $("pwInput");
    input.value = chars.join("");
    input.type = "text";
    checkPassword();
}

async function copyPassword() {
    const value = $("pwInput").value;
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
// FAKE EMAIL TRAINING
// ==========================================

const QUIZ_EMAILS = [
    {
        from: "Account Security <support@qona-sacco-verify.com>",
        subject: "URGENT: Your account will be suspended in 24 hours",
        body: "Dear Customer,\n\nWe noticed unusual activity on your account. To avoid suspension you must confirm your password within 24 hours.\n\n[Verify now] → http://qona-sacco-verify.com/login\n\nAccount Security Team",
        phishing: true,
        flags: ["Lookalike domain: it isn't your organisation's real address", "Threat and deadline create panic", "Generic greeting (“Dear Customer”)", "Asks you to confirm your password via a link"]
    },
    {
        from: "IT Service Desk <servicedesk@yourcompany.example>",
        subject: "Scheduled maintenance on Saturday, 10pm to 12am",
        body: "Hello team,\n\nThe email server will be briefly unavailable on Saturday night during planned maintenance. No action is needed from you.\n\nThanks,\nIT Service Desk",
        phishing: false,
        flags: ["Comes from your organisation's real domain", "Asks you to do nothing: no links, files or passwords", "Calm tone with no pressure"]
    },
    {
        from: "James Mwangi (CEO) <ceo.office.mwangi@gmail.com>",
        subject: "Quick favour, are you at your desk?",
        body: "I'm in a meeting and can't talk. I need you to buy 5 gift cards for a client today and send me the codes. Keep this between us. I'll reimburse you tonight.\n\nSent from my phone",
        phishing: true,
        flags: ["An executive using a free Gmail address", "Secrecy: “keep this between us”", "Gift cards and urgency are classic fraud signs", "Avoids phone calls so you can't verify it"]
    },
    {
        from: "Parcel Service <delivery-alert@track-parcel-now.net>",
        subject: "Delivery failed: action required",
        body: "We couldn't deliver your parcel. Open the attached form and pay a small redelivery fee.\n\nAttachment: delivery_form.pdf.exe\nTrack: http://bit.ly/3xYzParcel",
        phishing: true,
        flags: ["You weren't expecting a parcel", "Double extension .pdf.exe is a program, not a PDF", "Shortened link hides the real destination", "Asks for a payment"]
    },
    {
        from: "Finance <finance@yourcompany.example>",
        subject: "Your expense claim #4821 was approved",
        body: "Hi Amina,\n\nYour expense claim #4821 for transport (KES 3,200) has been approved and will be paid with this month's salary.\n\nRegards,\nFinance Team",
        phishing: false,
        flags: ["Real internal address and uses your name", "Refers to something you actually submitted", "No links, attachments or requests"]
    }
];

let quizIndex = 0;
let quizScore = 0;

function renderQuiz() {
    const box = $("quizBox");
    if (!box) return;

    if (quizIndex >= QUIZ_EMAILS.length) {
        const message = quizScore >= 4 ? "Excellent. You have a sharp eye for phishing."
            : quizScore >= 3 ? "Good effort. Review the warning signs above and try again."
            : "Keep practising. Read the warning signs above, then try again.";
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
    $("quizActions").hidden = true;
    $("quizFeedback").innerHTML = `
        <div class="feedback ${correct ? "right" : "wrong"}">
            <strong>${correct ? "Correct!" : "Not quite."} This email is ${e.phishing ? "phishing" : "legitimate"}.</strong>
            <ul>${e.flags.map((f) => `<li>${escapeHTML(f)}</li>`).join("")}</ul>
            <button type="button" class="submit-btn" onclick="nextQuiz()">${last ? "See my score" : "Next email"}</button>
        </div>`;
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
    $("incidentType").value = "Phishing";
}


// ==========================================
// PAGES (HASH ROUTER)
// ==========================================

const VIEWS = {
    password:       { title: "Password Check",     subtitle: "Test how strong a password is before you use it" },
    phishing:       { title: "Spot Fake Emails",   subtitle: "Learn the warning signs of phishing and test yourself" },
    dashboard:      { title: "Security Dashboard", subtitle: "Monitor and manage cybersecurity incidents" },
    incidents:      { title: "Incidents",          subtitle: "Search, filter and manage every reported incident" },
    investigations: { title: "Investigations",     subtitle: "Follow each case from report to resolution" },
    reports:        { title: "Reports",            subtitle: "Trends and summaries across all incidents" },
    settings:       { title: "Settings",           subtitle: "Customise how the dashboard looks and works" }
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

    $("pageTitle").textContent = VIEWS[view].title;
    $("pageSubtitle").textContent = VIEWS[view].subtitle;
    document.title = `${VIEWS[view].title} · Cyber Incident Management System`;

    // Move focus to the heading after navigating (not on first load)
    if (!firstRoute) $("pageTitle").focus();
    firstRoute = false;
    window.scrollTo(0, 0);
}


// ==========================================
// DASHBOARD: LATEST INCIDENTS
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


// ==========================================
// INVESTIGATIONS BOARD
// ==========================================

const STATUSES = ["NEW", "UNDER INVESTIGATION", "CONTAINED", "RESOLVED"];

function renderBoard() {
    const board = $("investigationBoard");
    if (!board) return;

    board.innerHTML = STATUSES.map((status) => {
        const cases = incidents
            .filter((i) => i.Status === status)
            .sort((a, b) => (SEVERITY_RANK[b.Severity] || 0) - (SEVERITY_RANK[a.Severity] || 0));

        const cards = cases.map((i) => `
            <button type="button" class="case-card row-${toClassName(i.Severity)}" data-incident-id="${i.IncidentID}">
                <span class="case-top">
                    <strong>${formatIncidentId(i.IncidentID)}</strong>
                    <span class="severity ${toClassName(i.Severity)}">${escapeHTML(i.Severity)}</span>
                </span>
                <span class="case-title">${escapeHTML(i.IncidentTitle)}</span>
                <span class="case-meta">${escapeHTML(i.AffectedSystem)} · ${escapeHTML(formatDate(i.DateReported))}</span>
            </button>
        `).join("");

        return `
            <div class="board-column">
                <h3>${escapeHTML(status)} <span class="board-count">${cases.length}</span></h3>
                <div class="board-cards">${cards || '<p class="board-empty">No incidents</p>'}</div>
            </div>
        `;
    }).join("");
}


// ==========================================
// REPORTS
// ==========================================

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
        .map(([label, count]) => `
            <li>
                <span class="bar-label">${escapeHTML(label)}</span>
                <span class="bar-track"><span class="bar-fill" style="width:${total ? Math.round((count / total) * 100) : 0}%"></span></span>
                <span class="bar-count">${count}</span>
            </li>
        `).join("");

    return `
        <div class="report-block">
            <h3>${title}</h3>
            <ul class="bar-list">${rows || '<li class="board-empty">No data yet</li>'}</ul>
        </div>
    `;
}

function renderReports() {
    const total = incidents.length;
    const resolved = incidents.filter((i) => i.Status === "RESOLVED").length;
    const criticalOpen = incidents.filter((i) => i.Severity === "Critical" && i.Status !== "RESOLVED").length;
    const rate = total ? Math.round((resolved / total) * 100) : 0;

    const kpi = (cls, icon, label, value) => `
        <div class="stat-card ${cls}">
            <div class="stat-icon" aria-hidden="true">${icon}</div>
            <div><span>${label}</span><h2>${value}</h2></div>
        </div>
    `;

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
        // Storage unavailable; the choice just won't persist
    }

    const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(pref === "system" ? (systemDark ? "dark" : "light") : pref);
}

async function refreshData() {
    await loadIncidents();
    showToast("Data refreshed.", "success");
}


// ==========================================
// INIT
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
    setupModalDismissal();
    applyTheme(document.documentElement.dataset.theme || "light");

    let savedTheme = "system";
    try { savedTheme = localStorage.getItem("theme") || "system"; } catch { /* ignore */ }
    if ($("themeSelect")) $("themeSelect").value = savedTheme;

    window.addEventListener("hashchange", route);

    checkPassword();
    renderQuiz();
    if (!DEMO_MODE) $("demoBox").hidden = true;

    // Restore a signed-in session after a page refresh
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

    // One listener opens the details for any table button or board card
    document.addEventListener("click", (event) => {
        const trigger = event.target.closest("[data-incident-id]");
        if (trigger) viewIncident(trigger.dataset.incidentId);
    });

});