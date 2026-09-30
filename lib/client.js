window.__ModuleLoader__.load({
	id: "dsh-jev-subagent-dispatch",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		"use strict";
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name2 in all)
		    __defProp(target, name2, { get: all[name2], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
		  // If the importer is in node compatibility mode or this is not an ESM
		  // file that has been converted to a CommonJS file using a Babel-
		  // compatible transform (i.e. "__esModule" has not been set), then set
		  // "default" to the CommonJS "module.exports" for node compatibility.
		  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
		  mod
		));
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

		// src/client/index.tsx
		var index_exports = {};
		__export(index_exports, {
		  apply: () => apply,
		  inject: () => inject,
		  name: () => name
		});
		module.exports = __toCommonJS(index_exports);
		var React = __toESM(require("react"), 1);

		// src/client/JevSettingsCard.tsx
		var import_react = require("react");

		// src/shared/config.mjs
		var SETTINGS_NAMESPACE = "jev-subagent-dispatch";
		var PLUGIN_NAME = "jev-subagent-dispatch";
		var PACKAGE_NAME = "dsh-jev-subagent-dispatch";
		var ROW_CONFIG_KEY = `${PACKAGE_NAME}#${PLUGIN_NAME}`;
		var SUBAGENT_ALLOWLIST_NAMESPACE = "subagent-model-selection-settings";
		var SUBAGENT_NAMESPACE = "subagent";
		var PROVIDER_PRESETS = {
		  bai: { endpoint: "https://api.b.ai", apiPath: "/v1/decisions", apiKeyEnv: "OPENROUTER_API_KEY", model: "jev-1.13.0" },
		  openrouter: { endpoint: "https://openrouter.ai/api/v1", apiPath: "/systemone", apiKeyEnv: "OPENROUTER_API_KEY", model: "jev-1.13" },
		  typesafe: { endpoint: "https://api.typesafe.ai", apiPath: "/v1/systemone", apiKeyEnv: "TYPESAFE_API_KEY", model: "jev-1.13.0" }
		};

		// src/client/locales.ts
		var en = {
		  title: "Jev subagent dispatch",
		  description: "Recommends which subagent model should take a task — cheap routes for routine work, the main model for the hard parts.",
		  mode: "Mode",
		  modeOff: "Off",
		  modeOnce: "On request",
		  modeAuto: "Every turn",
		  provider: "Provider preset",
		  profile: "Decision profile",
		  profileHint: "auto = looser thresholds, careful = stricter; the thresholds themselves live in the profile patch.",
		  endpoint: "Endpoint",
		  apiPath: "API path",
		  apiKeyEnv: "Key reference",
		  apiKeyEnvHint: "Name of the credential (Settings → Models) or of the environment variable; resolved before every call. The key itself never enters the UI.",
		  model: "Classifier model",
		  triggers: "Request triggers",
		  triggersHint: "Comma-separated; only used in “On request” mode.",
		  routes: "Routes",
		  routesHint: "Comma-separated role=provider/model. Every model must be one your Subagent allowlist permits, or the verdict has nowhere to dispatch. Empty restores the shipped defaults.",
		  routesPickHint: "One choice per role, taken from your Subagent allowlist — so nothing here can name a model that would leave a verdict stranded.",
		  timeoutMs: "Call timeout (ms)",
		  stateChars: "State cap (chars)",
		  logDir: "Verdict log directory",
		  logDirHint: "Empty = logging off. NDJSON records of every verdict (answers included, turn text excluded).",
		  logTurnText: "Include turn text in the log",
		  logTurnTextHint: "Off by default — the log carries answers and metadata, not your words.",
		  overridden: "overridden",
		  reset: "reset",
		  saving: "saving…",
		  unavailable: "Settings are read-only here — edit the profile patch.",
		  subagentMissing: "The Subagent plugin is not active, so a verdict would have nowhere to go. Enable it under Plugins — Jev still classifies, but nothing can be dispatched until it is on.",
		  advanced: "Classifier endpoint (advanced)",
		  advancedHint: "Preset values; edit only to point at a gateway the preset does not cover."
		};
		var zh = {
		  title: "Jev 子代理调度",
		  description: "为每个任务推荐合适的子代理模型——常规工作走便宜路由，主模型专注难点。",
		  mode: "模式",
		  modeOff: "关闭",
		  modeOnce: "按请求",
		  modeAuto: "每轮",
		  provider: "提供商预设",
		  profile: "决策档位",
		  profileHint: "auto = 阈值宽松，careful = 更严格；阈值本身在 profile patch 中编辑。",
		  endpoint: "端点",
		  apiPath: "API 路径",
		  apiKeyEnv: "密钥引用",
		  apiKeyEnvHint: "凭据名称（设置 → 模型）或环境变量名称；每次调用前解析。密钥本身不进入界面。",
		  model: "分类器模型",
		  triggers: "请求触发词",
		  triggersHint: "逗号分隔；仅在“按请求”模式下使用。",
		  routes: "路由",
		  routesHint: "逗号分隔 role=provider/model。模型必须在子代理白名单内，否则判定结果无处可去。留空恢复默认值。",
		  routesPickHint: "每个角色从子代理白名单中选择模型——这样就不会写出让判定无处可去的路由。",
		  timeoutMs: "调用超时（毫秒）",
		  stateChars: "状态上限（字符）",
		  logDir: "判定日志目录",
		  logDirHint: "留空 = 关闭日志。每次判定的 NDJSON 记录（含答案，不含对话文本）。",
		  logTurnText: "日志中包含对话文本",
		  logTurnTextHint: "默认关闭——日志只携带答案与元数据，不记录你的原话。",
		  overridden: "已覆盖",
		  reset: "还原",
		  saving: "保存中…",
		  unavailable: "此处设置只读——请编辑 profile patch。",
		  subagentMissing: "子代理插件未启用，判定结果将无处可去。请在 Plugins 中启用它——Jev 仍会分类，但在此之前无法派发。",
		  advanced: "分类器端点（高级）",
		  advancedHint: "预设值；仅在预设未覆盖的网关时修改。"
		};
		var ru = {
		  title: "Jev dispatch субагентов",
		  description: "Рекомендует, какой субагент-моделью взять задачу — рутину на дешёвые маршруты, сложное остаётся основной модели.",
		  mode: "Режим",
		  modeOff: "Выкл.",
		  modeOnce: "По запросу",
		  modeAuto: "Каждый ход",
		  provider: "Пресет провайдера",
		  profile: "Профиль решений",
		  profileHint: "auto = свободные пороги, careful = строгие; сами пороги правятся в profile patch.",
		  endpoint: "Endpoint",
		  apiPath: "API-путь",
		  apiKeyEnv: "Ссылка на ключ",
		  apiKeyEnvHint: "Имя credential (Настройки → Модели) или переменной окружения; разрешается перед каждым вызовом. Сам ключ в интерфейс не попадает.",
		  model: "Модель классификатора",
		  triggers: "Триггеры запроса",
		  triggersHint: "Через запятую; используются только в режиме «По запросу».",
		  routes: "Маршруты",
		  routesHint: "Через запятую: роль=провайдер/модель. Модель должна быть в вашем списке разрешённых для субагентов, иначе вердикту некуда вести. Пусто — вернуть значения по умолчанию.",
		  routesPickHint: "По выбору на каждую роль, из вашего списка разрешённых для субагентов — сюда нельзя вписать модель, из-за которой вердикт останется без адреса.",
		  timeoutMs: "Тайм-аут вызова (мс)",
		  stateChars: "Лимит состояния (символов)",
		  logDir: "Каталог лога вердиктов",
		  logDirHint: "Пусто = лог выключен. NDJSON-записи каждого вердикта (с ответами, без текста хода).",
		  logTurnText: "Писать текст хода в лог",
		  logTurnTextHint: "По умолчанию выкл. — в лог идут ответы и метаданные, не ваши слова.",
		  overridden: "переопределено",
		  reset: "сброс",
		  saving: "сохранение…",
		  unavailable: "Здесь настройки только для чтения — правьте profile patch.",
		  subagentMissing: "Плагин Subagent не активен, поэтому вердикту некуда будет вести. Включите его в Plugins — Jev по-прежнему классифицирует, но передать задачу не сможет.",
		  advanced: "Endpoint классификатора (подробно)",
		  advancedHint: "Значения пресета; меняйте только для шлюза, которого пресет не покрывает."
		};

		// src/client/i18n.ts
		var active = (key) => String(en[key] ?? key);
		function bindTranslator(translate) {
		  active = translate;
		}
		var tr = (key) => active(key);
		var listeners = /* @__PURE__ */ new Set();
		var version = 0;
		function subscribeLocale(listener) {
		  listeners.add(listener);
		  return () => {
		    listeners.delete(listener);
		  };
		}
		function localeRevision() {
		  return version;
		}
		function notifyLocale() {
		  version += 1;
		  for (const listener of listeners) listener();
		}

		// src/client/JevSettingsCard.tsx
		var import_jsx_runtime = require("react/jsx-runtime");
		var MODES = [
		  { id: "off", labelKey: "modeOff" },
		  { id: "once", labelKey: "modeOnce" },
		  { id: "auto", labelKey: "modeAuto" }
		];
		var PROVIDERS = Object.keys(PROVIDER_PRESETS);
		var PROFILES = ["auto", "careful"];
		var inputStyle = {
		  width: "100%",
		  boxSizing: "border-box",
		  padding: "6px 8px",
		  borderRadius: 6,
		  border: "1px solid var(--dsw-alias-border-default, #444)",
		  background: "var(--dsw-alias-bg-input, transparent)",
		  color: "inherit",
		  font: "inherit"
		};
		var labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 2 };
		var hintStyle = { fontSize: 11, color: "var(--dsw-alias-text-tertiary, #888)", marginTop: 3 };
		var resetStyle = {
		  marginLeft: 6,
		  font: "inherit",
		  fontSize: 10,
		  background: "none",
		  border: "none",
		  color: "inherit",
		  cursor: "pointer",
		  textDecoration: "underline"
		};
		var segWrap = { display: "flex", gap: 0, borderRadius: 6, overflow: "hidden", border: "1px solid var(--dsw-alias-border-default, #444)", width: "fit-content" };
		var segBtn = (active2) => ({
		  font: "inherit",
		  fontSize: 12,
		  padding: "5px 14px",
		  border: "none",
		  cursor: "pointer",
		  background: active2 ? "var(--dsw-alias-bg-accent, #35506b)" : "transparent",
		  color: active2 ? "#fff" : "inherit"
		});
		var errorStyle = { fontSize: 11, color: "var(--dsw-alias-text-danger, #e66)", marginTop: 4 };
		var versionStyle = {
		  fontSize: 10,
		  margin: "14px 0 0",
		  opacity: 0.55,
		  letterSpacing: 0.2,
		  fontFamily: "var(--dsw-alias-font-mono, ui-monospace, monospace)"
		};
		var warningStyle = {
		  fontSize: 11,
		  margin: "0 0 12px",
		  padding: "8px 10px",
		  borderRadius: 6,
		  border: "1px solid var(--dsw-alias-border-danger, #a33)",
		  background: "var(--dsw-alias-bg-danger-subtle, rgba(200, 60, 60, 0.12))",
		  color: "var(--dsw-alias-text-danger, #e66)"
		};
		var groupStyle = { borderTop: "1px solid var(--dsw-alias-border-default, #333)", marginTop: 16, paddingTop: 10 };
		var headStyle = { fontSize: 12, fontWeight: 700, margin: "0 0 8px", color: "var(--dsw-alias-text-secondary, #aaa)" };
		function useScopeSnapshot(scope) {
		  const subscribe = (0, import_react.useCallback)((listener) => scope.subscribe(listener), [scope]);
		  const get = (0, import_react.useCallback)(() => scope.getSnapshot(), [scope]);
		  return (0, import_react.useSyncExternalStore)(subscribe, get, get);
		}
		function useLocaleRevision() {
		  return (0, import_react.useSyncExternalStore)(subscribeLocale, localeRevision, localeRevision);
		}
		var NO_ALLOWLIST = {
		  status: "unavailable",
		  value: void 0,
		  base: void 0,
		  user: void 0,
		  revision: void 0
		};
		var NO_ALLOWLIST_SCOPE = {
		  getSnapshot: () => NO_ALLOWLIST,
		  subscribe: () => () => {
		  },
		  set: async () => {
		  },
		  unset: async () => {
		  }
		};
		function allowlistKeys(value) {
		  const entries = value?.allowedModels;
		  if (!Array.isArray(entries)) return [];
		  return entries.filter((entry) => entry?.provider && entry?.model).map((entry) => `${entry.provider}/${entry.model}`);
		}
		function Field(props) {
		  const [draft, setDraft] = (0, import_react.useState)(null);
		  const [error, setError] = (0, import_react.useState)(null);
		  const shown = draft ?? props.value;
		  const commit = () => {
		    if (draft === null) return;
		    setDraft(null);
		    try {
		      const parsed = props.parse(shown);
		      setError(null);
		      props.onCommit(parsed);
		    } catch (e) {
		      setError(String(e?.message ?? e));
		    }
		  };
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: 12 }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { htmlFor: props.id, style: labelStyle, children: [
		      props.label,
		      props.overridden && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { marginLeft: 8, fontSize: 10, fontWeight: 400, color: "var(--dsw-alias-text-accent, #69f)" }, children: [
		        tr("overridden"),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: resetStyle, onClick: props.onReset, disabled: props.disabled, children: tr("reset") })
		      ] })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		      "input",
		      {
		        id: props.id,
		        type: "text",
		        style: { ...inputStyle, ...props.monospace ? { fontFamily: "var(--dsw-alias-font-mono, monospace)" } : {} },
		        value: shown,
		        disabled: props.disabled,
		        placeholder: props.placeholder,
		        onChange: (e) => setDraft(e.target.value),
		        onBlur: commit,
		        onKeyDown: (e) => {
		          if (e.key === "Enter") commit();
		        }
		      }
		    ),
		    error !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: errorStyle, children: error }),
		    props.hint && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: hintStyle, children: props.hint })
		  ] });
		}
		function Choice(props) {
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: 12 }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { htmlFor: props.id, style: labelStyle, children: [
		      props.label,
		      props.overridden && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { marginLeft: 8, fontSize: 10, fontWeight: 400, color: "var(--dsw-alias-text-accent, #69f)" }, children: [
		        tr("overridden"),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: resetStyle, onClick: props.onReset, disabled: props.disabled, children: tr("reset") })
		      ] })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		      "select",
		      {
		        id: props.id,
		        style: inputStyle,
		        value: props.value,
		        disabled: props.disabled,
		        onChange: (e) => props.onCommit(e.target.value),
		        children: props.options.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: option.id, children: option.label }, option.id))
		      }
		    ),
		    props.hint && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: hintStyle, children: props.hint })
		  ] });
		}
		function Toggle(props) {
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: 12 }, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { htmlFor: props.id, style: { ...labelStyle, fontWeight: 400 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		        "input",
		        {
		          id: props.id,
		          type: "checkbox",
		          checked: props.checked,
		          disabled: props.disabled,
		          onChange: (e) => props.onCommit(e.target.checked),
		          style: { marginRight: 6, verticalAlign: "middle" }
		        }
		      ),
		      props.label,
		      props.overridden && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { marginLeft: 8, fontSize: 10, color: "var(--dsw-alias-text-accent, #69f)" }, children: [
		        tr("overridden"),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: resetStyle, onClick: props.onReset, disabled: props.disabled, children: tr("reset") })
		      ] })
		    ] }),
		    props.hint && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...hintStyle, marginLeft: 20 }, children: props.hint })
		  ] });
		}
		function JevSettingsCard(props) {
		  useLocaleRevision();
		  const snap = useScopeSnapshot(props.scope);
		  const allowSnap = useScopeSnapshot(props.allowlist ?? NO_ALLOWLIST_SCOPE);
		  const allowed = allowlistKeys(allowSnap.value);
		  const subagentSnap = useScopeSnapshot(props.subagent ?? NO_ALLOWLIST_SCOPE);
		  const subagentMissing = props.subagent !== void 0 && subagentSnap.status === "unavailable";
		  const [pending, setPending] = (0, import_react.useState)(0);
		  const value = snap.value ?? {};
		  const preset = PROVIDER_PRESETS[value.provider ?? "typesafe"] ?? {};
		  const writable = snap.writable !== false && snap.status === "ready";
		  const disabled = !writable;
		  const showHeading = props.heading !== false;
		  const commit = (0, import_react.useCallback)((field, parsed) => {
		    setPending((n) => n + 1);
		    void props.scope.set(field, parsed).catch(() => {
		    }).finally(() => setPending((n) => n - 1));
		  }, [props.scope]);
		  const reset = (0, import_react.useCallback)((field) => {
		    setPending((n) => n + 1);
		    void props.scope.unset(field).catch(() => {
		    }).finally(() => setPending((n) => n - 1));
		  }, [props.scope]);
		  const overridden = (field) => snap.user?.[field] !== void 0;
		  if (snap.status === "loading") return showHeading ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: hintStyle, children: [
		    tr("title"),
		    "…"
		  ] }) : null;
		  if (snap.status === "unavailable") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: hintStyle, children: tr("unavailable") });
		  const number = (min, max) => (text) => {
		    const n = Number(text);
		    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${min}–${max}`);
		    return n;
		  };
		  const list = (text) => text.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
		  const trimmed = (text) => {
		    const v = text.trim();
		    if (v.length === 0) throw new Error("empty");
		    return v;
		  };
		  const optionalDir = (text) => text.trim();
		  const routesText = (routes) => Object.entries(routes ?? {}).map(([role, target]) => `${role}=${[target?.provider, target?.model].filter(Boolean).join("/")}`).join(", ");
		  const parseRoutes = (text) => {
		    const entries = text.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
		    if (entries.length === 0) return null;
		    const parsed = {};
		    for (const entry of entries) {
		      const eq = entry.indexOf("=");
		      const slash = eq === -1 ? -1 : entry.indexOf("/", eq + 1);
		      if (eq < 1 || slash < eq + 2 || slash === entry.length - 1) throw new Error("role=provider/model");
		      parsed[entry.slice(0, eq).trim()] = {
		        provider: entry.slice(eq + 1, slash).trim(),
		        model: entry.slice(slash + 1).trim()
		      };
		    }
		    return parsed;
		  };
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		    showHeading ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 13, fontWeight: 700, marginBottom: 2 }, children: tr("title") }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: { ...hintStyle, marginTop: 0 }, children: [
		        tr("description"),
		        pending > 0 ? ` · ${tr("saving")}` : ""
		      ] })
		    ] }) : pending > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...hintStyle, marginTop: 0 }, children: tr("saving") }) : null,
		    subagentMissing && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: warningStyle, role: "status", children: tr("subagentMissing") }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: 12 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: labelStyle, children: tr("mode") }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: segWrap, children: MODES.map((mode) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		        "button",
		        {
		          type: "button",
		          style: segBtn((value.mode ?? "off") === mode.id),
		          disabled,
		          onClick: () => commit("mode", mode.id),
		          children: tr(mode.labelKey)
		        },
		        mode.id
		      )) })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		      Choice,
		      {
		        id: "jev-provider",
		        label: tr("provider"),
		        options: PROVIDERS.map((id) => ({ id, label: id })),
		        value: value.provider ?? "bai",
		        overridden: overridden("provider"),
		        disabled,
		        onCommit: (next) => commit("provider", next),
		        onReset: () => reset("provider")
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		      Choice,
		      {
		        id: "jev-profile",
		        label: tr("profile"),
		        hint: tr("profileHint"),
		        options: PROFILES.map((id) => ({ id, label: id })),
		        value: value.activeProfile ?? "auto",
		        overridden: overridden("activeProfile"),
		        disabled,
		        onCommit: (next) => commit("activeProfile", next),
		        onReset: () => reset("activeProfile")
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		      Field,
		      {
		        id: "jev-triggers",
		        label: tr("triggers"),
		        hint: tr("triggersHint"),
		        value: (value.triggers ?? []).join(", "),
		        overridden: overridden("triggers"),
		        disabled,
		        parse: list,
		        onCommit: (parsed) => commit("triggers", parsed),
		        onReset: () => reset("triggers")
		      }
		    ),
		    allowed.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: 12 }, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: labelStyle, children: [
		        tr("routes"),
		        overridden("routes") && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { marginLeft: 8, fontSize: 10, fontWeight: 400, color: "var(--dsw-alias-text-accent, #69f)" }, children: [
		          tr("overridden"),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: resetStyle, onClick: () => reset("routes"), disabled, children: tr("reset") })
		        ] })
		      ] }),
		      Object.entries(value.routes ?? {}).map(([role, target]) => {
		        const current = `${target?.provider}/${target?.model}`;
		        const options = allowed.includes(current) ? allowed : [current, ...allowed];
		        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 6 }, children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: `jev-route-${role}`, style: { ...labelStyle, minWidth: 110, marginBottom: 0 }, children: role }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		            "select",
		            {
		              id: `jev-route-${role}`,
		              style: { ...inputStyle, width: "auto", flex: 1 },
		              value: current,
		              disabled,
		              onChange: (event) => {
		                const [provider, ...rest] = event.target.value.split("/");
		                commit("routes", { ...value.routes, [role]: { provider, model: rest.join("/") } });
		              },
		              children: options.map((key) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: key, children: key }, key))
		            }
		          )
		        ] }, role);
		      }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: hintStyle, children: tr("routesPickHint") })
		    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		      Field,
		      {
		        id: "jev-routes",
		        label: tr("routes"),
		        hint: tr("routesHint"),
		        value: routesText(value.routes),
		        overridden: overridden("routes"),
		        disabled,
		        parse: parseRoutes,
		        onCommit: (parsed) => {
		          if (parsed === null) reset("routes");
		          else commit("routes", parsed);
		        },
		        onReset: () => reset("routes"),
		        monospace: true
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		      Toggle,
		      {
		        id: "jev-logturn",
		        label: tr("logTurnText"),
		        hint: tr("logTurnTextHint"),
		        checked: value.logTurnText ?? false,
		        overridden: overridden("logTurnText"),
		        disabled,
		        onCommit: (next) => commit("logTurnText", next),
		        onReset: () => reset("logTurnText")
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		      Field,
		      {
		        id: "jev-logdir",
		        label: tr("logDir"),
		        hint: tr("logDirHint"),
		        value: value.logDir ?? "",
		        overridden: overridden("logDir"),
		        disabled,
		        parse: optionalDir,
		        onCommit: (parsed) => {
		          if (parsed === "") reset("logDir");
		          else commit("logDir", parsed);
		        },
		        onReset: () => reset("logDir")
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		      Field,
		      {
		        id: "jev-statechars",
		        label: tr("stateChars"),
		        value: String(value.stateChars ?? 1200),
		        overridden: overridden("stateChars"),
		        disabled,
		        parse: number(200, 8e3),
		        onCommit: (parsed) => commit("stateChars", parsed),
		        onReset: () => reset("stateChars")
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: groupStyle, children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: headStyle, children: tr("advanced") }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...hintStyle, marginTop: -4, marginBottom: 8 }, children: tr("advancedHint") }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		        Field,
		        {
		          id: "jev-apikeyenv",
		          label: tr("apiKeyEnv"),
		          hint: tr("apiKeyEnvHint"),
		          value: value.apiKeyEnv ?? "",
		          placeholder: preset.apiKeyEnv,
		          overridden: overridden("apiKeyEnv"),
		          disabled,
		          monospace: true,
		          parse: trimmed,
		          onCommit: (parsed) => commit("apiKeyEnv", parsed),
		          onReset: () => reset("apiKeyEnv")
		        }
		      ),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }, children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		          Field,
		          {
		            id: "jev-endpoint",
		            label: tr("endpoint"),
		            value: value.endpoint ?? "",
		            placeholder: preset.endpoint,
		            overridden: overridden("endpoint"),
		            disabled,
		            parse: trimmed,
		            onCommit: (parsed) => commit("endpoint", parsed),
		            onReset: () => reset("endpoint"),
		            monospace: true
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		          Field,
		          {
		            id: "jev-apipath",
		            label: tr("apiPath"),
		            value: value.apiPath ?? "",
		            placeholder: preset.apiPath,
		            overridden: overridden("apiPath"),
		            disabled,
		            parse: trimmed,
		            onCommit: (parsed) => commit("apiPath", parsed),
		            onReset: () => reset("apiPath"),
		            monospace: true
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		          Field,
		          {
		            id: "jev-model",
		            label: tr("model"),
		            value: value.model ?? "",
		            placeholder: preset.model,
		            overridden: overridden("model"),
		            disabled,
		            parse: trimmed,
		            onCommit: (parsed) => commit("model", parsed),
		            onReset: () => reset("model"),
		            monospace: true
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
		          Field,
		          {
		            id: "jev-timeout",
		            label: tr("timeoutMs"),
		            value: String(value.timeoutMs ?? 4e3),
		            overridden: overridden("timeoutMs"),
		            disabled,
		            parse: number(50, 3e4),
		            onCommit: (parsed) => commit("timeoutMs", parsed),
		            onReset: () => reset("timeoutMs")
		          }
		        )
		      ] })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: versionStyle, children: [
		      PACKAGE_NAME,
		      " ",
		      "v",
		      true ? "0.7.4" : "dev"
		    ] })
		  ] });
		}

		// src/client/index.tsx
		function wireLocale(ctx) {
		  const locale = ctx.locale;
		  if (!locale) return;
		  try {
		    ctx.effect(() => locale.register(SETTINGS_NAMESPACE, "en", en));
		    ctx.effect(() => locale.register(SETTINGS_NAMESPACE, "zh", zh));
		    ctx.effect(() => locale.register(SETTINGS_NAMESPACE, "ru", ru));
		    const hasRu = (locale.getSnapshot?.().locales ?? []).some((entry) => entry.id === "ru");
		    if (!hasRu) ctx.effect(() => locale.addLanguage({ id: "ru", label: "Русский", fallback: "en" }));
		    const translate = locale.bind(SETTINGS_NAMESPACE);
		    bindTranslator((key) => translate(key));
		    ctx.effect(() => locale.subscribe(() => notifyLocale()));
		  } catch {
		  }
		}
		var name = "dsh-jev-subagent-dispatch";
		var inject = ["slots", "locale"];
		function registerRowConfig(ctx) {
		  ctx.inject(["configForms"], (c) => {
		    const card = (props) => props?.view === "summary" ? null : React.createElement(JevSettingsCard, {
		      scope: c.configForms.get(SETTINGS_NAMESPACE),
		      // The Subagent allowlist lives in another plugin's namespace. Reading it
		      // is what lets the route selects offer only models dispatch may use; if
		      // that plugin is absent the scope simply reports nothing and the card
		      // keeps its raw field.
		      allowlist: c.configForms.get(SUBAGENT_ALLOWLIST_NAMESPACE),
		      // Liveness probe for the delegation tools: a namespace the loader does
		      // not serve reports unavailable, and the card tells the user to enable
		      // the plugin instead of letting a verdict go quietly nowhere.
		      subagent: c.configForms.get(SUBAGENT_NAMESPACE),
		      heading: false
		    });
		    const register = () => {
		      try {
		        c.slots.inject("plugins.bundle.config", () => c.slots.register({ name: "plugins.bundle.config", key: PACKAGE_NAME, locale: SETTINGS_NAMESPACE }, card));
		      } catch {
		      }
		      try {
		        c.slots.inject("plugins.row.config", () => c.slots.register({ name: "plugins.row.config", key: ROW_CONFIG_KEY, locale: SETTINGS_NAMESPACE }, card));
		      } catch {
		      }
		    };
		    try {
		      if (typeof c.configForms?.whileServed === "function") {
		        c.effect(() => c.configForms.whileServed([SETTINGS_NAMESPACE], register), "jev-subagent-dispatch: settings page");
		      } else {
		        register();
		      }
		    } catch {
		    }
		  });
		}
		function registerSettingsItem(ctx) {
		  ctx.inject(["settingsScope"], (c) => {
		    try {
		      const scope = c.settingsScope.bind({ namespace: SETTINGS_NAMESPACE });
		      c.slots.inject(
		        "settings.plugin.item",
		        () => c.slots.register(
		          { name: "settings.plugin.item", key: SETTINGS_NAMESPACE, id: PLUGIN_NAME, order: 30 },
		          () => React.createElement(JevSettingsCard, { scope })
		        )
		      );
		    } catch {
		    }
		  });
		}
		function apply(ctx) {
		  wireLocale(ctx);
		  registerRowConfig(ctx);
		  registerSettingsItem(ctx);
		}

		return module.exports;
	}
});
