async function probe({ request }) {
  const [api, web] = await Promise.allSettled([
    request("api", { accept: "application/json", maximumBytes: 32768 }),
    request("web", { accept: "text/html", maximumBytes: 262144 }),
  ]);
  const result = { api: "outage", web: "outage", access: "unknown" };
  if (api.status === "fulfilled") {
    const { response, text, blockedByAuthorization } = api.value;
    if (blockedByAuthorization) result.api = "unknown";
    try {
      const body = JSON.parse(text);
      if (response.headers.get("content-type")?.includes("application/json") && body.service === "example-api") {
        result.api = response.status !== 200 || body.supabaseConnected === false ? "outage" : body.supabaseConnected === true ? "operational" : "unknown";
        result.access = body.supabaseConnected === true ? "operational" : body.supabaseConnected === false ? "outage" : "unknown";
      }
    } catch {}
  }
  if (web.status === "fulfilled") {
    const {response,text,blockedByAuthorization} = web.value;
    if (blockedByAuthorization) result.web = "unknown";
    if (response.status === 200 && response.headers.get("content-type")?.includes("text/html") && /<html(?:\s|>)/i.test(text)
        && /<div\s[^>]*id=["']root["']/i.test(text) && /<script\s[^>]*type=["']module["']/i.test(text)) result.web = "operational";
  }
  return result;
}
export default {
  id: "example", components: [{id:"api",name:"Сервис Example"},{id:"web",name:"Веб-приложение"},{id:"access",name:"Доступ к данным"}],
  outageComponents: ["api","web"], targetVariables: {api:"STATUS_API_URL",web:"STATUS_WEB_URL"}, probe,
};
