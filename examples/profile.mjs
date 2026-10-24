// Keep the real project profile in the consuming project repository.
export default {
  id: "example", components: [{ id: "web", name: "Веб-приложение" }],
  outageComponents: ["web"], targetVariables: { web: "STATUS_WEB_URL" },
  async probe({ request }) {
    try {
      const { response, text, blockedByAuthorization } = await request("web", {accept: "text/html", maximumBytes: 262144});
      return { web: blockedByAuthorization ? "unknown" : response.status === 200 && /<html[\s>]/i.test(text) ? "operational" : "outage" };
    } catch { return {web: "outage"}; }
  },
};
