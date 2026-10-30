import "./styles.css";

const state = {
  user: null, users: [], platforms: [], vault: [], usefulLinks: [],
  access: { items: [], users: [], grants: [] },
  accessMode: "users", challengeId: null,
  // Set from the Platforms / Users screens: { type: "platform" | "user", id, label }
  vaultFilter: null,
};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || "Request failed"), { body, status: response.status });
  return body;
}

// Downloads a POST response as a file, using the server-provided filename.
async function downloadExport(url, payload, fallbackName) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Export failed");
  const filename = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] || fallbackName;
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
  return filename;
}

function showAuthStep(id) {
  ["#loginForm", "#otpForm", "#secretLoginForm"].forEach((selector) => $(selector).classList.toggle("hidden", selector !== id));
  ["#loginError", "#otpError", "#secretLoginError"].forEach((selector) => $(selector).classList.add("hidden"));
}

function showError(selector, message) {
  $(selector).textContent = message;
  $(selector).classList.remove("hidden");
}

function openSecretCodeDialog({ forced = false } = {}) {
  const form = $("#secretCodeForm");
  form.reset();
  const changing = Boolean(state.user?.secretCodeSet) && !forced;
  form.dataset.forced = forced ? "true" : "";
  $("#secretCodeTitle").textContent = changing ? "Change your secret code" : "Set your secret code";
  $("#secretCodeIntro").textContent = forced
    ? "Required before using the vault: choose an 8-character secret code. If you ever cannot receive the email code, sign in with your password and this code."
    : "Choose a new 8-character secret code. It replaces the current one.";
  $("#currentPasswordField").classList.toggle("hidden", !changing);
  form.elements.currentPassword.required = changing;
  $("#secretCodeClose").classList.toggle("hidden", forced);
  $("#secretCodeCancel").classList.toggle("hidden", forced);
  $("#secretCodeError").classList.add("hidden");
  $("#secretCodeDialog").showModal();
}

function isAdmin() {
  return ["admin", "superAdmin"].includes(state.user?.role);
}

function notify(message, type = "success") {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = `notice ${type}`;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => notice.classList.add("hidden"), 4000);
}

function showView(name) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  $("#pageTitle").textContent = $(`.nav-item[data-view="${name}"]`)?.textContent || "Overview";
  if (name === "it-tools") {
    const frame = $("#itToolsFrame");
    if (frame && !frame.dataset.loaded) {
      frame.src = frame.dataset.src;
      frame.dataset.loaded = "true";
    }
  }
  document.body.classList.remove("menu-open");
}

function makeButton(label, action, id, className = "secondary small") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = className;
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function appendRevealDetail(container, label, value, options = {}) {
  const detail = document.createElement("div");
  detail.className = `reveal-detail${options.wide ? " wide" : ""}`;
  const heading = document.createElement("strong");
  heading.textContent = label;
  let content;
  let safeUrl = "";
  if (options.link && value) {
    try {
      const parsed = new URL(value);
      if (["http:", "https:"].includes(parsed.protocol)) safeUrl = parsed.href;
    } catch { /* Display invalid or legacy values as text only. */ }
  }
  if (safeUrl) {
    content = document.createElement("a");
    content.href = safeUrl;
    content.target = "_blank";
    content.rel = "noopener noreferrer";
  } else {
    content = document.createElement("span");
  }
  content.textContent = value || "—";
  if (options.multiline) content.classList.add("multiline");
  detail.append(heading, content);
  container.append(detail);
}

function itemPlatformId(item) {
  return String(item.platformId?._id || item.platformId || "");
}

function vaultItemsForPlatform(platformId) {
  return state.vault.filter((item) => itemPlatformId(item) === String(platformId));
}

function vaultItemsForUser(user) {
  return state.vault.filter((item) => userAccessToItem(user, item));
}

function showVaultFiltered(filter) {
  state.vaultFilter = filter;
  $("#vaultSearch").value = "";
  renderVault();
  showView("passwords");
}

function renderUsers() {
  const rows = $("#userRows");
  rows.replaceChildren();
  state.users.forEach((user) => {
    const row = document.createElement("tr");
    const identity = document.createElement("td");
    const name = document.createElement("strong");
    name.textContent = `${user.firstName} ${user.lastName}`;
    const email = document.createElement("small");
    email.textContent = user.email;
    identity.append(name, email);
    const role = document.createElement("td");
    role.textContent = user.role === "superAdmin" ? "Super admin" : user.role;
    const status = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `badge ${user.status}`;
    badge.textContent = user.status;
    status.append(badge);
    const actionCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(makeButton(`Passwords (${vaultItemsForUser(user).length})`, "user-passwords", user._id), makeButton("Edit", "edit-user", user._id));
    if (user.status === "active" && user._id !== state.user._id) actions.append(makeButton("Disable", "delete-user", user._id, "danger small"));
    actionCell.append(actions);
    row.append(identity, role, status, actionCell);
    rows.append(row);
  });

  const selects = [$("#accessUser")];
  selects.forEach((select) => {
    select.replaceChildren();
    state.users.filter((user) => user.status === "active").forEach((user) => {
      select.add(new Option(`${user.firstName} ${user.lastName} (${user.email})`, user._id));
    });
  });
}

function renderPlatforms() {
  const rows = $("#platformRows");
  rows.replaceChildren();
  state.platforms.forEach((platform) => {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = platform.name;
    const category = document.createElement("td");
    category.textContent = platform.category || "—";
    const url = document.createElement("td");
    if (platform.loginUrl) {
      const link = document.createElement("a");
      link.href = platform.loginUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open login";
      url.append(link);
    } else url.textContent = "—";
    const actionCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(makeButton(`Passwords (${vaultItemsForPlatform(platform._id).length})`, "platform-passwords", platform._id), makeButton("Edit", "edit-platform", platform._id), makeButton("Archive", "delete-platform", platform._id, "danger small"));
    actionCell.append(actions);
    row.append(name, category, url, actionCell);
    rows.append(row);
  });

  const select = $("#vaultPlatform");
  select.replaceChildren();
  state.platforms.forEach((platform) => select.add(new Option(platform.name, platform._id)));
}

function renderVault() {
  const rows = $("#vaultRows");
  rows.replaceChildren();
  const query = $("#vaultSearch").value.trim().toLowerCase();
  const filter = state.vaultFilter;
  $("#vaultFilter").classList.toggle("hidden", !filter);
  $("#vaultFilterLabel").textContent = filter?.label || "";
  let filterUser = null;
  if (filter?.type === "user") filterUser = state.users.find((user) => user._id === filter.id) || { _id: filter.id };
  const scopedItems = !filter ? state.vault
    : filter.type === "platform" ? vaultItemsForPlatform(filter.id) : vaultItemsForUser(filterUser);
  const visibleItems = scopedItems.filter((item) => [
    item.name,
    item.username,
    item.platformId?.name,
    item.platformId?.category,
    item.vaultType,
  ].some((value) => String(value || "").toLowerCase().includes(query)));

  if (!visibleItems.length) {
    const row = document.createElement("tr");
    const empty = document.createElement("td");
    empty.className = "empty";
    empty.colSpan = 5;
    empty.textContent = query
      ? "No passwords match your search."
      : filter ? `No passwords linked to ${filter.label}.`
      : (isAdmin() ? "No passwords yet. Add the first password." : "No credentials assigned yet.");
    row.append(empty);
    rows.append(row);
    return;
  }

  visibleItems.forEach((item) => {
    const row = document.createElement("tr");
    row.className = "vault-row";
    const name = document.createElement("td");
    const title = document.createElement("strong");
    title.textContent = item.name;
    name.append(title);
    const platform = document.createElement("td");
    platform.textContent = item.platformId?.name || "Platform";
    const username = document.createElement("td");
    username.textContent = item.username || "—";
    const access = document.createElement("td");
    const personal = item.vaultType === "personal" || (!item.vaultType && item.ownerUserId);
    const accessType = document.createElement("strong");
    accessType.textContent = personal ? "Personal" : "Company";
    const sharing = document.createElement("small");
    sharing.textContent = `Shared with ${item.sharedWithCount || 0} ${item.sharedWithCount === 1 ? "person" : "people"}`;
    access.append(accessType, sharing);
    const actionCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "actions";
    if (item.canReveal) actions.append(makeButton("Reveal", "reveal-vault", item._id, "small"));
    if (item.platformId?.loginUrl) actions.append(makeButton("Open", "open-platform", item._id));
    if (item.canManageAccess) actions.append(makeButton("Share", "share-vault", item._id));
    if (item.canEdit) actions.append(makeButton("Edit", "edit-vault", item._id), makeButton("Delete", "delete-vault", item._id, "danger small"));
    actionCell.append(actions);
    row.append(name, platform, username, access, actionCell);
    const revealRow = document.createElement("tr");
    revealRow.className = "vault-reveal-row hidden";
    const revealCell = document.createElement("td");
    revealCell.colSpan = 5;
    const secret = document.createElement("div");
    secret.className = "secret reveal-details";
    revealCell.append(secret);
    revealRow.append(revealCell);
    rows.append(row, revealRow);
  });
}

function renderUsefulLinks() {
  const rows = $("#usefulLinkRows");
  rows.replaceChildren();
  if (!state.usefulLinks.length) {
    const row = document.createElement("tr");
    const empty = document.createElement("td");
    empty.className = "empty";
    empty.colSpan = isAdmin() ? 3 : 2;
    empty.textContent = isAdmin() ? "No useful links yet. Add Design | figma.com or Algorithm | draw.io." : "No useful links have been added yet.";
    row.append(empty);
    rows.append(row);
    return;
  }
  state.usefulLinks.forEach((entry) => {
    const row = document.createElement("tr");
    const category = document.createElement("td");
    category.textContent = entry.category;
    const linkCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = entry.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    try { link.textContent = new URL(entry.url).hostname; } catch { link.textContent = entry.url; }
    const address = document.createElement("small");
    address.textContent = entry.url;
    linkCell.append(link, address);
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(makeButton("Edit", "edit-useful-link", entry._id), makeButton("Delete", "delete-useful-link", entry._id, "danger small"));
    const actionCell = document.createElement("td");
    actionCell.className = "admin-only";
    if (!isAdmin()) actionCell.classList.add("role-hidden");
    actionCell.append(actions);
    row.append(category, linkCell, actionCell);
    rows.append(row);
  });
}

function companyItem(item) {
  return item.vaultType === "company" || (!item.vaultType && !item.ownerUserId);
}

function userAccessToItem(user, item) {
  if (String(item.ownerUserId || "") === String(user._id)) return { label: "Owner", kind: "owner" };
  if (["admin", "superAdmin"].includes(user.role) && companyItem(item)) return { label: "Company administrator", kind: "role" };
  const grant = state.access.grants.find((entry) => String(entry.userId) === String(user._id) && String(entry.vaultItemId) === String(item._id));
  return grant ? { label: grant.permissions.join(", "), kind: "grant", grant } : null;
}

function renderAccessDetails(entityId) {
  const details = $("#accessDetails");
  details.replaceChildren();
  $("#accessDetailEmpty").classList.add("hidden");
  const title = document.createElement("h3");
  const list = document.createElement("div");
  list.className = "permission-list";

  if (state.accessMode === "users") {
    const user = state.access.users.find((entry) => entry._id === entityId);
    if (!user) return;
    title.textContent = `${user.firstName} ${user.lastName}`;
    const accessible = state.access.items.map((item) => ({ item, access: userAccessToItem(user, item) })).filter((entry) => entry.access);
    accessible.forEach(({ item, access }) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "permission-row";
      row.innerHTML = `<span><strong></strong><small></small></span><em></em>`;
      row.querySelector("strong").textContent = item.name;
      row.querySelector("small").textContent = item.platformId?.name || "Platform";
      row.querySelector("em").textContent = access.label;
      row.addEventListener("click", () => {
        $("#accessVault").value = item._id;
        $("#accessUser").value = user._id;
        if (access.grant) setPermissionChecks(access.grant.permissions);
      });
      list.append(row);
    });
    if (!accessible.length) list.textContent = "No passwords assigned to this user in your manageable vaults.";
  } else {
    const item = state.access.items.find((entry) => entry._id === entityId);
    if (!item) return;
    title.textContent = item.name;
    const people = state.access.users.map((user) => ({ user, access: userAccessToItem(user, item) })).filter((entry) => entry.access);
    people.forEach(({ user, access }) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "permission-row";
      row.innerHTML = `<span><strong></strong><small></small></span><em></em>`;
      row.querySelector("strong").textContent = `${user.firstName} ${user.lastName}`;
      row.querySelector("small").textContent = user.email;
      row.querySelector("em").textContent = access.label;
      row.addEventListener("click", () => {
        $("#accessVault").value = item._id;
        $("#accessUser").value = user._id;
        if (access.grant) setPermissionChecks(access.grant.permissions);
      });
      list.append(row);
    });
  }
  details.append(title, list);
}

function setPermissionChecks(permissions = ["view", "reveal"]) {
  $$('#accessForm input[name="permissions"]').forEach((input) => { input.checked = permissions.includes(input.value); });
}

function renderAccess() {
  const vaultSelect = $("#accessVault");
  const userSelect = $("#accessUser");
  vaultSelect.replaceChildren();
  userSelect.replaceChildren();
  state.access.items.forEach((item) => vaultSelect.add(new Option(`${item.name} — ${item.username || "no username"}`, item._id)));
  state.access.users.filter((user) => user._id !== state.user._id).forEach((user) => userSelect.add(new Option(`${user.firstName} ${user.lastName} (${user.email})`, user._id)));

  const entities = $("#accessEntities");
  entities.replaceChildren();
  const source = state.accessMode === "users" ? state.access.users : state.access.items;
  $("#accessListTitle").textContent = state.accessMode === "users" ? "Users" : "Passwords";
  source.forEach((entity) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "entity-button";
    button.dataset.accessEntity = entity._id;
    if (state.accessMode === "users") {
      button.textContent = `${entity.firstName} ${entity.lastName}`;
      const count = state.access.items.filter((item) => userAccessToItem(entity, item)).length;
      button.title = `${count} password${count === 1 ? "" : "s"}`;
    } else {
      button.textContent = entity.name;
      const count = state.access.users.filter((user) => userAccessToItem(user, entity)).length;
      button.title = `${count} user${count === 1 ? "" : "s"}`;
    }
    entities.append(button);
  });
  $("#accessDetails").replaceChildren();
  $("#accessDetailEmpty").classList.remove("hidden");
  $("#accessDetailEmpty").textContent = state.accessMode === "users"
    ? "Select a user to see all passwords they can access."
    : "Select a password to see every person who can access it.";
}

async function loadData() {
  const tasks = [request("/api/vault"), request("/api/platforms"), request("/api/vault-access"), request("/api/useful-links")];
  if (isAdmin()) tasks.push(request("/api/users"));
  const results = await Promise.all(tasks);
  state.vault = results[0].items;
  state.platforms = results[1].platforms;
  state.access = results[2];
  state.usefulLinks = results[3].links;
  state.users = isAdmin() ? results[4].users : results[2].users.map((user) => ({ ...user, status: "active" }));
  if (isAdmin()) {
    renderUsers();
  }
  renderPlatforms();
  renderVault();
  renderAccess();
  renderUsefulLinks();
  $("#statPasswords").textContent = state.vault.length;
  $("#statUsers").textContent = state.users.filter((user) => user.status === "active").length;
  $("#statAccess").textContent = state.access.grants.length;
  $("#usersOverviewHint").textContent = isAdmin() ? "Manage company users" : "Browse password access by user";
}

async function startSession() {
  try {
    const { user } = await request("/api/auth/me");
    state.user = user;
    $("#loginView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    $$(".admin-only").forEach((element) => element.classList.toggle("role-hidden", !isAdmin()));
    $$(".superadmin-only").forEach((element) => element.classList.toggle("role-hidden", user.role !== "superAdmin"));
    $("#sessionUser").textContent = `${user.firstName} ${user.lastName}`;
    $("#profileEmail").textContent = user.email;
    $("#sessionRole").textContent = user.role === "superAdmin" ? "Super admin" : user.role;
    if (!user.secretCodeSet) {
      openSecretCodeDialog({ forced: true });
      return;
    }
    await loadData();
  } catch {
    state.user = null;
    $("#loginView").classList.remove("hidden");
    $("#appView").classList.add("hidden");
  }
}

function openUserDialog(user = null) {
  const form = $("#userForm");
  form.reset();
  form.elements.id.value = user?._id || "";
  form.elements.firstName.value = user?.firstName || "";
  form.elements.lastName.value = user?.lastName || "";
  form.elements.email.value = user?.email || "";
  form.elements.role.value = user?.role || "member";
  form.elements.status.value = user?.status || "active";
  form.elements.password.required = !user;
  $("#passwordField").classList.toggle("hidden", Boolean(user));
  $("#statusField").classList.toggle("hidden", !user);
  $("#userDialogTitle").textContent = user ? "Edit user" : "Add user";
  $("#userDialog").showModal();
}

function openPlatformDialog(platform = null) {
  const form = $("#platformForm");
  form.reset();
  for (const field of ["id", "name", "category", "websiteUrl", "loginUrl"]) form.elements[field].value = platform?.[field === "id" ? "_id" : field] || "";
  $("#platformDialogTitle").textContent = platform ? "Edit platform" : "Add platform";
  $("#platformDialog").showModal();
}

function openUsefulLinkDialog(link = null) {
  const form = $("#usefulLinkForm");
  form.reset();
  form.elements.id.value = link?._id || "";
  form.elements.category.value = link?.category || "";
  form.elements.url.value = link?.url || "";
  $("#usefulLinkDialogTitle").textContent = link ? "Edit useful link" : "Add useful link";
  $("#usefulLinkDialog").showModal();
}

async function openVaultDialog(item = null) {
  const form = $("#vaultForm");
  form.reset();
  form.elements.id.value = item?._id || "";
  $("#vaultDialogTitle").textContent = item ? "Edit password" : "Add password";
  form.elements.password.required = true;
  if (item) {
    const result = await request(`/api/vault/${item._id}/reveal`, { method: "POST" });
    const full = result.item;
    form.elements.name.value = full.name;
    form.elements.platformId.value = full.platformId?._id || full.platformId;
    form.elements.username.value = full.username || "";
    form.elements.vaultType.value = full.vaultType || (full.ownerUserId ? "personal" : "company");
    form.elements.password.value = full.secret.password || "";
    form.elements.totpSecret.value = full.secret.totpSecret || "";
    form.elements.recoveryCodes.value = (full.secret.recoveryCodes || []).join("\n");
    form.elements.notes.value = full.secret.notes || "";
  }
  $("#vaultDialog").showModal();
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("#signinButton");
  $("#loginError").textContent = "";
  $("#loginError").classList.add("hidden");
  submit.disabled = true;
  submit.textContent = "Sending secure code…";
  try {
    const result = await request("/api/auth/signin", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    state.challengeId = result.challengeId;
    $("#otpMessage").textContent = `We sent an eight-digit code to ${result.maskedEmail}. It expires in 10 minutes.`;
    event.target.reset();
    event.target.classList.add("hidden");
    $("#otpForm").classList.remove("hidden");
    window.location.hash = "verify-email";
    $("#otpForm").elements.code.focus();
  } catch (error) {
    if (error.body?.secretCodeAvailable) {
      state.challengeId = error.body.challengeId;
      event.target.reset();
      showAuthStep("#secretLoginForm");
      $("#secretLoginMessage").textContent = "The email code could not be sent. Enter your 8-character secret code to sign in.";
      $("#secretLoginForm").elements.secretCode.focus();
      return;
    }
    $("#loginError").textContent = `Code not sent: ${error.message}`;
    $("#loginError").classList.remove("hidden");
  } finally {
    submit.disabled = false;
    submit.textContent = "Send verification code";
  }
});

$("#otpForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#otpError").textContent = "";
  $("#otpError").classList.add("hidden");
  try {
    await request("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ challengeId: state.challengeId, code: event.target.elements.code.value }),
    });
    state.challengeId = null;
    event.target.reset();
    event.target.classList.add("hidden");
    $("#loginForm").classList.remove("hidden");
    window.history.replaceState(null, "", window.location.pathname);
    await startSession();
  } catch (error) {
    $("#otpError").textContent = error.message;
    $("#otpError").classList.remove("hidden");
  }
});

$("#backToLogin").addEventListener("click", () => {
  state.challengeId = null;
  $("#otpForm").reset();
  $("#otpForm").classList.add("hidden");
  $("#loginForm").classList.remove("hidden");
  window.history.replaceState(null, "", window.location.pathname);
});

$("#resendOtp").addEventListener("click", async () => {
  const button = $("#resendOtp");
  $("#otpError").classList.add("hidden");
  button.disabled = true;
  button.textContent = "Sending new code…";
  try {
    const result = await request("/api/auth/resend-email", {
      method: "POST",
      body: JSON.stringify({ challengeId: state.challengeId }),
    });
    state.challengeId = result.challengeId;
    $("#otpMessage").textContent = `A new eight-digit code was sent to ${result.maskedEmail}. Previous codes are now invalid.`;
    $("#otpForm").elements.code.value = "";
    $("#otpForm").elements.code.focus();
  } catch (error) {
    $("#otpError").textContent = error.message;
    $("#otpError").classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.textContent = "Resend a new code";
  }
});

$("#exportDatabase").addEventListener("click", async () => {
  const button = $("#exportDatabase");
  button.disabled = true;
  button.textContent = "Exporting…";
  try {
    const filename = await downloadExport("/api/export", {}, "database-export.json");
    notify(`Database exported to ${filename}`);
  } catch (error) {
    notify(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Export JSON";
  }
});

// Hidden: 5 taps on the "Enter your code" title within 3 s open the secret-code sign-in (same as H_CHAT).
let otpTitleTaps = [];
$("#otpTitle").addEventListener("click", () => {
  const now = Date.now();
  otpTitleTaps = [...otpTitleTaps.filter((time) => now - time < 3000), now];
  if (otpTitleTaps.length < 5) return;
  otpTitleTaps = [];
  showAuthStep("#secretLoginForm");
  $("#secretLoginMessage").textContent = "Can't receive the email code? Enter the 8-character secret code you set for this account.";
  $("#secretLoginForm").elements.secretCode.focus();
});

$("#backToOtp").addEventListener("click", () => {
  $("#secretLoginForm").reset();
  showAuthStep("#otpForm");
  $("#otpForm").elements.code.focus();
});

$("#secretBackToLogin").addEventListener("click", () => {
  state.challengeId = null;
  $("#otpForm").reset();
  $("#secretLoginForm").reset();
  showAuthStep("#loginForm");
  window.history.replaceState(null, "", window.location.pathname);
});

$("#secretLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#secretLoginError").classList.add("hidden");
  try {
    await request("/api/auth/verify-secret-code", {
      method: "POST",
      body: JSON.stringify({ challengeId: state.challengeId, secretCode: event.target.elements.secretCode.value }),
    });
    state.challengeId = null;
    $("#otpForm").reset();
    event.target.reset();
    showAuthStep("#loginForm");
    window.history.replaceState(null, "", window.location.pathname);
    await startSession();
  } catch (error) {
    event.target.elements.secretCode.value = "";
    showError("#secretLoginError", error.message);
  }
});

$("#changeSecretCode").addEventListener("click", () => openSecretCodeDialog());
$("#profileSecretCode").addEventListener("click", () => openSecretCodeDialog());

$("#passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.elements.newPassword.value !== form.elements.confirmPassword.value) return notify("The two new passwords do not match", "error");
  try {
    const result = await request("/api/profile/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: form.elements.currentPassword.value, newPassword: form.elements.newPassword.value }),
    });
    state.user = result.user;
    form.reset();
    notify("Password changed. Other sessions were signed out.");
  } catch (error) { notify(error.message, "error"); }
});

function resetEmailChange() {
  state.emailChallengeId = null;
  $("#emailForm").reset();
  $("#emailConfirmForm").reset();
  $("#emailConfirmForm").classList.add("hidden");
  $("#emailForm").classList.remove("hidden");
}

$("#emailForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = $("#emailSubmit");
  button.disabled = true;
  try {
    const result = await request("/api/profile/email", {
      method: "POST",
      body: JSON.stringify({ newEmail: form.elements.newEmail.value, currentPassword: form.elements.currentPassword.value }),
    });
    state.emailChallengeId = result.challengeId;
    $("#emailConfirmMessage").textContent = `We sent an eight-digit code to ${result.maskedEmail}. It expires in 10 minutes.`;
    form.classList.add("hidden");
    $("#emailConfirmForm").classList.remove("hidden");
    $("#emailConfirmForm").elements.code.focus();
  } catch (error) {
    notify(error.message, "error");
  } finally {
    form.elements.currentPassword.value = "";
    button.disabled = false;
  }
});

$("#emailConfirmForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await request("/api/profile/email/confirm", {
      method: "POST",
      body: JSON.stringify({ challengeId: state.emailChallengeId, code: event.target.elements.code.value }),
    });
    state.user = result.user;
    $("#profileEmail").textContent = result.user.email;
    resetEmailChange();
    notify(`Email changed to ${result.user.email}. Use it for your next sign-in.`);
    await loadData();
  } catch (error) {
    event.target.elements.code.value = "";
    notify(error.message, "error");
  }
});

$("#emailConfirmCancel").addEventListener("click", resetEmailChange);
// The first-time setup cannot be dismissed with Escape.
$("#secretCodeDialog").addEventListener("cancel", (event) => {
  if ($("#secretCodeForm").dataset.forced) event.preventDefault();
});

$("#secretCodeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const forced = Boolean(form.dataset.forced);
  const secretCode = form.elements.secretCode.value;
  if (secretCode !== form.elements.confirmSecretCode.value) return showError("#secretCodeError", "The two secret codes do not match");
  if (!/^\S{8}$/.test(secretCode)) return showError("#secretCodeError", "Exactly 8 characters, no spaces (digits, letters or both)");
  try {
    const result = await request("/api/auth/secret-code", {
      method: "POST",
      body: JSON.stringify({ secretCode, currentPassword: form.elements.currentPassword.value }),
    });
    state.user = result.user;
    form.dataset.forced = "";
    $("#secretCodeDialog").close();
    notify(forced ? "Secret code saved. Keep it somewhere safe." : "Secret code changed");
    if (forced) await loadData();
  } catch (error) {
    showError("#secretCodeError", error.message);
  }
});

$("#exportExcel").addEventListener("click", () => {
  $("#excelForm").reset();
  $("#excelDialog").showModal();
});

$("#excelForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#excelSubmit");
  button.disabled = true;
  button.textContent = "Exporting…";
  try {
    const filename = await downloadExport("/api/export/excel", { password: event.target.elements.password.value }, "sec-vault-passwords.xlsx");
    $("#excelDialog").close();
    notify(`Passwords exported to ${filename}`);
  } catch (error) {
    notify(error.message, "error");
  } finally {
    event.target.reset();
    button.disabled = false;
    button.textContent = "Export Excel";
  }
});

$("#logout").addEventListener("click", async () => {
  await request("/api/auth/signout", { method: "POST" });
  await startSession();
});

$("#mainNav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  // The menu always opens the full list; filters come from the Platforms / Users buttons.
  if (button.dataset.view === "passwords" && state.vaultFilter) {
    state.vaultFilter = null;
    renderVault();
  }
  showView(button.dataset.view);
});
$("#overviewStats").addEventListener("click", (event) => {
  const card = event.target.closest("[data-overview-view]");
  if (!card) return;
  let view = card.dataset.overviewView;
  if (view === "passwords" && state.vaultFilter) {
    state.vaultFilter = null;
    renderVault();
  }
  if (view === "users" && !isAdmin()) {
    view = "access";
    state.accessMode = "users";
    $$(".access-mode").forEach((button) => button.classList.toggle("active", button.dataset.accessMode === "users"));
    renderAccess();
  }
  showView(view);
});
$("#mobileMenu").addEventListener("click", () => document.body.classList.toggle("menu-open"));
$("#vaultSearch").addEventListener("input", renderVault);
$("#clearVaultFilter").addEventListener("click", () => {
  state.vaultFilter = null;
  renderVault();
});
$("#newUser").addEventListener("click", () => openUserDialog());
$("#newPlatform").addEventListener("click", () => openPlatformDialog());
$("#newVault").addEventListener("click", () => openVaultDialog().catch((error) => notify(error.message, "error")));
$("#newUsefulLink").addEventListener("click", () => openUsefulLinkDialog());
$$('.access-mode').forEach((button) => button.addEventListener("click", () => {
  state.accessMode = button.dataset.accessMode;
  $$('.access-mode').forEach((entry) => entry.classList.toggle("active", entry === button));
  renderAccess();
}));
$("#accessEntities").addEventListener("click", (event) => {
  const button = event.target.closest("[data-access-entity]");
  if (!button) return;
  $$(".entity-button").forEach((entry) => entry.classList.toggle("active", entry === button));
  renderAccessDetails(button.dataset.accessEntity);
});
$$('.close-dialog').forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

$("#userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const id = data.id;
  delete data.id;
  try {
    await request(id ? `/api/users/${id}` : "/api/users", { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    $("#userDialog").close();
    notify(id ? "User updated" : "User created");
    await loadData();
  } catch (error) { notify(error.message, "error"); }
});

$("#platformForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const id = data.id;
  delete data.id;
  try {
    await request(id ? `/api/platforms/${id}` : "/api/platforms", { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    $("#platformDialog").close();
    notify(id ? "Platform updated" : "Platform created");
    await loadData();
  } catch (error) { notify(error.message, "error"); }
});

$("#vaultForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const id = data.id;
  delete data.id;
  data.recoveryCodes = data.recoveryCodes.split(/\r?\n/).map((code) => code.trim()).filter(Boolean);
  try {
    await request(id ? `/api/vault/${id}` : "/api/vault", { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    $("#vaultDialog").close();
    notify(id ? "Password updated" : "Password created");
    await loadData();
  } catch (error) { notify(error.message, "error"); }
});

$("#usefulLinkForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const id = data.id;
  delete data.id;
  try {
    await request(id ? `/api/useful-links/${id}` : "/api/useful-links", { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    $("#usefulLinkDialog").close();
    notify(id ? "Useful link updated" : "Useful link created");
    await loadData();
  } catch (error) { notify(error.message, "error"); }
});

$("#accessForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const vaultItemId = form.get("vaultItemId");
  const userId = form.get("userId");
  const permissions = form.getAll("permissions");
  if (!permissions.includes("view")) permissions.push("view");
  try {
    await request(`/api/vault/${vaultItemId}/grants`, { method: "PUT", body: JSON.stringify({ userId, permissions }) });
    notify("User access saved");
    await loadData();
  } catch (error) { notify(error.message, "error"); }
});

$("#revokeAccess").addEventListener("click", async () => {
  const vaultItemId = $("#accessVault").value;
  const userId = $("#accessUser").value;
  if (!vaultItemId || !userId || !window.confirm("Revoke this user's access to the selected password?")) return;
  try {
    await request(`/api/vault/${vaultItemId}/grants/${userId}`, { method: "DELETE" });
    notify("User access revoked");
    await loadData();
  } catch (error) { notify(error.message, "error"); }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  try {
    if (action === "platform-passwords") {
      const platform = state.platforms.find((entry) => entry._id === id);
      showVaultFiltered({ type: "platform", id, label: `platform ${platform?.name || ""}` });
    }
    if (action === "user-passwords") {
      const user = state.users.find((entry) => entry._id === id);
      showVaultFiltered({ type: "user", id, label: user ? `${user.firstName} ${user.lastName}` : "this user" });
    }
    if (action === "edit-user") openUserDialog(state.users.find((user) => user._id === id));
    if (action === "edit-platform") openPlatformDialog(state.platforms.find((platform) => platform._id === id));
    if (action === "edit-vault") await openVaultDialog(state.vault.find((item) => item._id === id));
    if (action === "edit-useful-link") openUsefulLinkDialog(state.usefulLinks.find((link) => link._id === id));
    if (action === "share-vault") {
      showView("access");
      $("#accessVault").value = id;
      $("#accessUser").focus();
    }
    if (action === "open-platform") {
      const item = state.vault.find((entry) => entry._id === id);
      window.open(item?.platformId?.loginUrl, "_blank", "noopener,noreferrer");
    }
    if (action === "reveal-vault") {
      const revealRow = button.closest(".vault-row").nextElementSibling;
      const secret = revealRow.querySelector(".secret");
      if (!revealRow.classList.contains("hidden")) {
        window.clearTimeout(revealRow.hideTimer);
        secret.replaceChildren();
        revealRow.classList.add("hidden");
        button.textContent = "Reveal";
        return;
      }

      button.disabled = true;
      button.textContent = "Loading...";
      let result;
      try {
        result = await request(`/api/vault/${id}/reveal`, { method: "POST" });
      } catch (error) {
        button.textContent = "Reveal";
        throw error;
      } finally {
        button.disabled = false;
      }
      secret.replaceChildren();
      const item = result.item;
      const value = result.item.secret;
      const loginUrl = item.platformId?.loginUrl || item.platformId?.websiteUrl || "";
      appendRevealDetail(secret, "Name", item.name);
      appendRevealDetail(secret, "Platform", item.platformId?.name);
      appendRevealDetail(secret, "Login / username", item.username);
      appendRevealDetail(secret, "Login link", loginUrl, { link: true });
      appendRevealDetail(secret, "Website", item.platformId?.websiteUrl, { link: true });
      appendRevealDetail(secret, "Password", value.password);
      appendRevealDetail(secret, "TOTP secret", value.totpSecret);
      const recoveryCodes = Array.isArray(value.recoveryCodes) ? value.recoveryCodes.join("\n") : value.recoveryCodes;
      appendRevealDetail(secret, "Recovery codes", recoveryCodes, { multiline: true, wide: true });
      appendRevealDetail(secret, "Sensitive notes", value.notes, { multiline: true, wide: true });
      appendRevealDetail(secret, "Vault type", item.vaultType === "personal" ? "Personal" : "Company");
      appendRevealDetail(secret, "Password changed", item.passwordChangedAt ? new Date(item.passwordChangedAt).toLocaleString() : "");
      revealRow.classList.remove("hidden");
      button.textContent = "Hide";
      window.clearTimeout(revealRow.hideTimer);
      revealRow.hideTimer = window.setTimeout(() => {
        secret.replaceChildren();
        revealRow.classList.add("hidden");
        button.textContent = "Reveal";
      }, 30000);
    }
    if (action.startsWith("delete-") && window.confirm("Are you sure? This action removes it from active use.")) {
      const resource = action.replace("delete-", "");
      await request(`/api/${resource === "vault" ? "vault" : `${resource}s`}/${id}`, { method: "DELETE" });
      notify(`${resource[0].toUpperCase()}${resource.slice(1)} removed`);
      await loadData();
    }
  } catch (error) { notify(error.message, "error"); }
});

startSession();
