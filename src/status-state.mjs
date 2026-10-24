import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import { profileComponents } from "./profile.mjs";
const statuses = new Set([
  "operational",
  "degraded",
  "outage",
  "unknown",
  "maintenance",
]);
const incidentStatuses = new Set(["investigating", "monitoring", "resolved"]);
const day = 86_400_000;
const labels = {
  operational: "Работает",
  degraded: "Проверяется сбой",
  outage: "Недоступно",
  unknown: "Нет актуальных данных",
  maintenance: "Плановые работы",
};
const historicalLabels = {
  operational: "Последняя проверка прошла успешно",
  degraded: "Последняя проверка обнаружила сбой",
  outage: "Недоступно при последней проверке",
  unknown: "Нет данных последней проверки",
  maintenance: "При последней проверке выполнялись плановые работы",
};
const incidentLabels = {
  investigating: "Проверяем сбой",
  monitoring: "Проверяем восстановление",
  resolved: "Восстановлено",
};
const messages = {
  investigating: "Повторные проверки подтвердили недоступность компонента.",
  monitoring:
    "Компонент ответил успешно. Проверяем устойчивость восстановления.",
  resolved: "Повторные проверки подтвердили восстановление компонента.",
  unknown: "Актуальное состояние компонента не удалось подтвердить.",
};

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).sort().join() === [...expected].sort().join();
}
function isTime(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function validateIncident(incident, resolved, product) {
  const components = profileComponents(product);
  if (
    !exactKeys(incident, [
      "componentId",
      "id",
      "title",
      "status",
      "statusLabel",
      "startedAt",
      "updatedAt",
      "resolvedAt",
      "updates",
    ]) ||
    !components.some(({ id }) => id === incident.componentId) ||
    !/^[a-f\d-]{36}$/.test(incident.id) ||
    incident.title !== `Недоступность: ${components.find(({ id }) => id === incident.componentId).name}` ||
    !incidentStatuses.has(incident.status) ||
    incident.statusLabel !== incidentLabels[incident.status] ||
    !isTime(incident.startedAt) ||
    !isTime(incident.updatedAt) ||
    Date.parse(incident.updatedAt) < Date.parse(incident.startedAt) ||
    (resolved
      ? incident.status !== "resolved" ||
        !isTime(incident.resolvedAt) ||
        incident.resolvedAt !== incident.updatedAt
      : incident.status === "resolved" || incident.resolvedAt !== null) ||
    !Array.isArray(incident.updates) ||
    incident.updates.length < 1 ||
    incident.updates.length > 20
  )
    throw new Error("Invalid persisted status incident");
  for (const update of incident.updates) {
    if (
      !exactKeys(update, ["at", "message"]) ||
      !isTime(update.at) ||
      !Object.values(messages).includes(update.message) ||
      Date.parse(update.at) < Date.parse(incident.startedAt) ||
      Date.parse(update.at) > Date.parse(incident.updatedAt)
    )
      throw new Error("Invalid persisted status incident update");
  }
}
export function validateState(state, product) {
  const components = profileComponents(product);
  if (
    !exactKeys(state, [
      "observedAt",
      "components",
      "activeIncidents",
      "history",
    ]) ||
    (state.observedAt !== null && !isTime(state.observedAt)) ||
    !Array.isArray(state.components) ||
    state.components.length !== components.length ||
    !Array.isArray(state.activeIncidents) ||
    state.activeIncidents.length > components.length ||
    !Array.isArray(state.history) ||
    state.history.length > 50
  )
    throw new Error("Invalid persisted status state");
  state.components.forEach((entry, index) => {
    if (
      !exactKeys(entry, [
        "id",
        "status",
        "failures",
        "successes",
        "incidentId",
      ]) ||
      entry.id !== components[index].id ||
      !statuses.has(entry.status) ||
      (entry.status === "maintenance" &&
        (!product.maintenance ||
          entry.failures !== 0 ||
          entry.successes !== 0)) ||
      ![0, 1, 2].includes(entry.failures) ||
      ![0, 1, 2].includes(entry.successes) ||
      (entry.failures > 0 && entry.successes > 0) ||
      (entry.incidentId !== null && typeof entry.incidentId !== "string")
    )
      throw new Error("Invalid persisted status component");
  });
  if (
    state.observedAt === null &&
    (state.components.some(
      (entry) =>
        entry.status !== "unknown" ||
        entry.failures !== 0 ||
        entry.successes !== 0 ||
        entry.incidentId !== null,
    ) ||
      state.activeIncidents.length ||
      state.history.length)
  )
    throw new Error("Unobserved persisted state cannot claim availability");
  const incidentIds = new Set();
  for (const [list, resolved] of [
    [state.activeIncidents, false],
    [state.history, true],
  ]) {
    for (const incident of list) {
      validateIncident(incident, resolved, product);
      if (
        incidentIds.has(incident.id) ||
        !state.observedAt ||
        Date.parse(incident.updatedAt) > Date.parse(state.observedAt)
      )
        throw new Error("Invalid persisted status incident identity");
      incidentIds.add(incident.id);
    }
  }
  const activeComponents = new Set();
  for (const incident of state.activeIncidents) {
    const component = state.components.find(
      ({ id }) => id === incident.componentId,
    );
    if (
      activeComponents.has(incident.componentId) ||
      component.incidentId !== incident.id
    )
      throw new Error("Invalid persisted active incident mapping");
    activeComponents.add(incident.componentId);
  }
  if (
    state.components.some(
      (entry) =>
        entry.incidentId !== null &&
        !state.activeIncidents.some(
          (incident) => incident.id === entry.incidentId,
        ),
    )
  )
    throw new Error("Invalid persisted component incident mapping");
  return state;
}
export function initialState(product) {
  const components = profileComponents(product);
  return {
    observedAt: null,
    components: components.map(({ id }) => ({
      id,
      status: "unknown",
      failures: 0,
      successes: 0,
      incidentId: null,
    })),
    activeIncidents: [],
    history: [],
  };
}
export async function loadState(path, product) {
  try {
    const bytes = await readFile(path, "utf8");
    if (bytes.length > 256_000)
      throw new Error("Status state exceeds its bound");
    const state = JSON.parse(bytes);
    return validateState(state, product);
  } catch (error) {
    if (error.code === "ENOENT") return initialState(product);
    throw new Error("Cannot load valid persisted status state", {
      cause: error,
    });
  }
}
export async function saveState(path, state, product) {
  validateState(state, product);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
function updateIncident(incident, status, at, message = messages[status]) {
  incident.status = status;
  incident.statusLabel = incidentLabels[status];
  incident.updatedAt = at;
  incident.updates = [...incident.updates, { at, message }].slice(-20);
}
export function observe(previous, observation, now, product) {
  const components = profileComponents(product);
  validateState(previous, product);
  if (previous.observedAt && now < Date.parse(previous.observedAt))
    throw new Error("Observation clock moved backwards");
  if (
    !exactKeys(
      observation,
      components.map(({ id }) => id),
    ) ||
    Object.values(observation).some(
      (value) =>
        !["operational", "outage", "unknown"].includes(value) &&
        !(product.maintenance && value === "maintenance"),
    )
  )
    throw new Error("Invalid status observation");
  const state = structuredClone(previous);
  const at = new Date(now).toISOString();
  state.observedAt = at;
  for (const component of state.components) {
    const result = observation[component.id];
    const incident = state.activeIncidents.find(
      ({ id }) => id === component.incidentId,
    );
    if (result === "maintenance") {
      component.failures = 0;
      component.successes = 0;
      component.status = "maintenance";
    } else if (result === "unknown") {
      component.failures = 0;
      component.successes = 0;
      component.status = "unknown";
      if (incident && incident.updates.at(-1).message !== messages.unknown)
        updateIncident(incident, "investigating", at, messages.unknown);
    } else if (result === "outage") {
      component.failures = Math.min(2, component.failures + 1);
      component.successes = 0;
      component.status =
        incident || component.failures === 2 ? "outage" : "degraded";
      if (incident && incident.status !== "investigating")
        updateIncident(incident, "investigating", at);
      if (!incident && component.failures === 2) {
        const created = {
          componentId: component.id,
          id: randomUUID(),
          title: `Недоступность: ${components.find(({ id }) => id === component.id).name}`,
          status: "investigating",
          statusLabel: incidentLabels.investigating,
          startedAt: at,
          updatedAt: at,
          resolvedAt: null,
          updates: [{ at, message: messages.investigating }],
        };
        component.incidentId = created.id;
        state.activeIncidents.push(created);
      }
    } else {
      component.successes = Math.min(2, component.successes + 1);
      component.failures = 0;
      component.status = incident ? "outage" : "operational";
      if (incident && component.successes === 1)
        updateIncident(incident, "monitoring", at);
      if (incident && component.successes === 2) {
        updateIncident(incident, "resolved", at);
        incident.resolvedAt = at;
        state.history.unshift(incident);
        state.activeIncidents = state.activeIncidents.filter(
          ({ id }) => id !== incident.id,
        );
        component.incidentId = null;
        component.status = "operational";
      }
    }
  }
  state.history = state.history
    .filter(({ resolvedAt }) => Date.parse(resolvedAt) >= now - 30 * day)
    .slice(0, 50);
  return validateState(state, product);
}
function publicIncident({ componentId, ...incident }, product) {
  return {
    ...incident,
    updates: incident.updates.toReversed().map((update) => ({ ...update })),
  };
}
export function publicStatus(state, now, validForMs, product) {
  const components = profileComponents(product);
  validateState(state, product);
  const validUntil = state.observedAt
    ? new Date(Date.parse(state.observedAt) + validForMs).toISOString()
    : null;
  const observationState = !state.observedAt
    ? "unobserved"
    : now < Date.parse(state.observedAt)
      ? "unconfirmed"
      : now >= Date.parse(validUntil)
        ? "stale"
        : "current";
  const current = observationState === "current";
  const prepared =
    observationState === "unobserved"
      ? []
      : state.components.map((entry, index) => {
          const status = current
            ? entry.status === "maintenance"
              ? "degraded"
              : entry.status
            : "unknown";
          return {
            ...components[index],
            status,
            label: current ? labels[entry.status] : labels.unknown,
          };
        });
  const lastKnownComponents =
    observationState === "stale"
      ? state.components.map((entry, index) => ({
          ...components[index],
          status: entry.status === "maintenance" ? "degraded" : entry.status,
          label: historicalLabels[entry.status],
        }))
      : [];
  let status;
  if (!current) status = "unknown";
  else if (
    prepared
      .filter(({ id }) => product.outageComponents.includes(id))
      .every((entry) => entry.status === "outage")
  )
    status = "outage";
  else if (
    prepared.some(
      (entry) => entry.status === "outage" || entry.status === "degraded",
    )
  )
    status = "degraded";
  else if (prepared.some((entry) => entry.status === "unknown"))
    status = "unknown";
  else status = "operational";
  const planned =
    current &&
    state.components.some((entry) => entry.status === "maintenance") &&
    state.components.every((entry) =>
      ["maintenance", "operational"].includes(entry.status),
    );
  const summaries = {
    operational: {
      title: "Сервисы работают",
      description:
        "Последние проверки компонентов прошли успешно.",
    },
    degraded: {
      title: "Часть сервиса недоступна",
      description:
        "Проверки обнаружили проблему с отдельным компонентом. Подробности приведены ниже.",
    },
    outage: {
      title: "Сервис недоступен",
      description:
        "Повторные проверки подтвердили недоступность компонентов.",
    },
    unknown: {
      title: "Состояние не подтверждено",
      description:
        "Проверки сейчас не дают результата. Мы не показываем состояние, которое не удалось подтвердить.",
    },
  };
  Object.assign(summaries, product.summaries ?? {});
  const freshnessSummaries = {
    unobserved: {
      title: "Наблюдений пока нет",
      description:
        "Проверки ещё не выполнялись. Состояние появится после первого наблюдения.",
    },
    stale: {
      title: "Данные о состоянии устарели",
      description:
        "Новых результатов проверок пока нет. Ниже — последнее известное состояние, оно может не соответствовать текущему. Страница обновится сама, как только появятся новые данные.",
    },
    unconfirmed: {
      title: "Состояние не подтверждено",
      description:
        "Время последнего наблюдения не удалось подтвердить. Мы не показываем состояние, которое не удалось подтвердить.",
    },
  };
  return {
    observedAt: state.observedAt,
    validUntil,
    observationState,
    overall: {
      status,
      ...(current
        ? planned
          ? {
              title: "Плановые работы",
              description:
                "Выполняется плановое обслуживание сервиса. Доступ восстановится после завершения работ.",
            }
          : summaries[status]
        : freshnessSummaries[observationState]),
    },
    components: prepared,
    lastKnownComponents,
    activeIncidents: state.activeIncidents.map(incident => publicIncident(incident, product)),
    history: state.history
      .filter(({ resolvedAt }) => Date.parse(resolvedAt) >= now - 30 * day)
      .map(incident => publicIncident(incident, product)),
    historyWindowLabel: "За последние 30 дней",
  };
}
