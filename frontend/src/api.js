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
};
