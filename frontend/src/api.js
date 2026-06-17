const BASE = process.env.REACT_APP_API_URL || "/api";

function getToken() {
  return localStorage.getItem("finance_token");
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export const api = {
  register: (email, password) =>
    request("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),

  login: (email, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  getEntries: () => request("/entries"),

  createEntry: (entry) =>
    request("/entries", { method: "POST", body: JSON.stringify(entry) }),

  updateEntry: (id, entry) =>
    request(`/entries/${id}`, { method: "PUT", body: JSON.stringify(entry) }),

  deleteEntry: (id) =>
    request(`/entries/${id}`, { method: "DELETE" }),

  getSummary: () => request("/entries/summary"),

  getPayCycleSettings: () => request("/settings/pay-cycle"),

  savePayCycleSettings: (settings) =>
    request("/settings/pay-cycle", { method: "PUT", body: JSON.stringify(settings) }),

  /**
   * Download all entries as a CSV file.
   * Returns { blob, filename } so the caller can trigger a browser download.
   */
  exportEntries: async () => {
    const token = getToken();
    const res = await fetch(`${BASE}/entries/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Export failed");
    }
    const blob = await res.blob();
    // The backend sets Content-Disposition: attachment; filename="finance-export-YYYY-MM-DD.csv"
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    const filename =
      match?.[1] ?? `finance-export-${new Date().toISOString().slice(0, 10)}.csv`;
    return { blob, filename };
  },

  /**
   * Upload a CSV File object and import its rows.
   * Returns ImportResult: { imported, skipped, errors[] }
   */
  importEntries: async (file) => {
    const token = getToken();
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${BASE}/entries/import`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
      // Do NOT set Content-Type — the browser sets it with the correct multipart boundary.
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Import failed");
    return data;
  },
};
